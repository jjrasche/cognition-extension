export const manifest = {
	name: "superintendent",
	context: ["service-worker"],
	version: "1.0.0",
	description: "Scrapes superintendent data for school districts using AI inference",
	dependencies: ["file", "inference"],
	requiredDirectories: ["Documents/cognition/data"],
	actions: ["processSingleDistrict", "processBatch", "getStats"]
};

let runtime, stats, districts, maxProcessed = 10;
const dir = 'Documents/cognition/data', filename = 'school-district-data.json';
export const initialize = async (rt) => {
	runtime = rt;
	resetStats();
	await loadDistricts();
};

export const processSingleDistrict = async (idx) => {
	const district = districts[idx];
	if (hasExistingData(district)) return;
	if (maxProcessed <= stats.processed) return;
	stats.processed++;
	try {
		const superintendentData = await extractSuperintendentData(district);
		updateDistrictData(idx, superintendentData);
		if (superintendentData.firstName && superintendentData.lastName) stats.updated++;
		else { updateDistrictData(idx, createEmptyData("no superintendent found")); stats.notFound++; }
	} catch (error) {
		runtime.logError(`❌ Error processing ${district.district}:`, error.message);
		stats.errors++;
		updateDistrictData(idx, createEmptyData(error.message));
	}
};
export const processBatch = async (maxParallel = 1, startIndex = 0) => {
	resetStats();
	try {
		await runtime.processWithWorkerPool(districts, processSingleDistrict, maxParallel, startIndex);
		logSummary();
	} catch (error) {
		runtime.logError('❌ Fatal error:', error);
	}
};

export const getStats = async () => {
	const fileStats = districts.reduce((acc, district) => {
		acc.total++;
		if (hasExistingData(district)) {
			acc.withData++;
			if (hasGroundTruthMismatch(district)) acc.mismatched++;
		} else acc.missing++;
		if (district.superIntendent?.sonnet35?.error) acc.errors++;
		return acc;
	}, { total: 0, withData: 0, missing: 0, errors: 0, mismatched: 0 });
	runtime.log('📊 File Stats:', fileStats);
	runtime.log('📊 Session Stats:', stats);
	return { file: fileStats, session: stats };
};

export const resetStats = () => stats = { processed: 0, updated: 0, skipped: 0, notFound: 0, errors: 0 };

// Helper functions
const loadDistricts = async () => {
	const content = await runtime.call('file.read', { dir, filename });
	if (!content) throw new Error(`Could not read ${filename}`);
	districts = JSON.parse(content);
};
const extractSuperintendentData = async (district) => {
	const prompt = buildSuperintendentPrompt(district);
	const systemPrompt = "You are an AI assistant specialized in finding superintendent information for school districts. Use the provided website to find the most accurate and up-to-date information. list every url you searched in ";
	const content = await runtime.call('inference.prompt', prompt, systemPrompt, webSearch(district));
	return parseSuperintendentResponse(content);
};
const webSearch = (district) => ({ max_uses: 5, allowedDomains: [district.website] });
const saveDistricts = async (districts) => await runtime.call('file.write', { dir, filename, data: JSON.stringify(districts, null, 2) });
const hasExistingData = (district) => {
	if (district.superIntendent?.sonnet35?.lastUpdated) {
		stats.skipped++;
		return true;
	}
	return false;
}
const hasGroundTruthMismatch = (district) => {
	const sonnet = district.superIntendent?.sonnet35;
	const crm = district.superIntendent?.crm;
	if (!sonnet || !crm) return false;
	const sonnetName = `${sonnet.firstName || ''} ${sonnet.lastName || ''}`.trim().toLowerCase();
	const crmName = `${crm.firstName || ''} ${crm.lastName || ''}`.trim().toLowerCase();
	const emailMismatch = sonnet.email && crm.email && sonnet.email.toLowerCase() !== crm.email.toLowerCase();
	return sonnetName !== crmName || emailMismatch;
};
const updateDistrictData = async (idx, data) => {
	if (!districts[idx].superIntendent) districts[idx].superIntendent = {};
	districts[idx].superIntendent.sonnet35 = { ...data, lastUpdated: new Date().toISOString() };
	await saveDistricts(districts);
};
const createEmptyData = (errorMessage = '') => ({ firstName: "", lastName: "", email: "", phone: "", sourceUrl: "", error: errorMessage });
const logSummary = () => runtime.log(`📊 SESSION:\nUpdated:${stats.updated}\nSkipped:${stats.skipped}\nErrors:${stats.errors}\nNot Found: ${stats.notFound}\nProcessed:${stats.processed}`);
const parseSuperintendentResponse = (responseText) => {
	try {
		const jsonMatch = responseText.match(/\{[\s\S]*\}/);
		if (jsonMatch) {
			const parsed = JSON.parse(jsonMatch[0]);
			if (parsed && typeof parsed === 'object') return {
				firstName: parsed.firstName || "",
				lastName: parsed.lastName || "",
				email: parsed.email || "",
				phone: parsed.phone || "",
				sourceUrl: parsed.sourceUrl || "",
				urlsSearched: parsed.urlsSearched || []
			};
		}
		return createEmptyData('No valid JSON response');
	} catch (error) {
		runtime.logError('Failed to parse superintendent response:', error);
		return createEmptyData(`Parse error: ${error.message}`);
	}
};
const buildSuperintendentPrompt = (district) => `
Find the current superintendent information for "${district.district}" school district.
Website: ${district.website}

Please search their website and find:
- Superintendent's first name
- Superintendent's last name  
- Email address (if available)
- Phone number (if available)

CRITICAL: You must provide the exact URL of the webpage where you found this information.

Return your response in this exact JSON format:
{
  "firstName": "John",
  "lastName": "Smith", 
  "email": "jsmith@district.edu",
  "phone": "555-123-4567",
  "sourceUrl": "https://district.edu/administration/superintendent",
  "urlsSearched": [
    "https://district.edu/administration/superintendent", ...
  ]
}

If you cannot find the information with high confidence, return the word null
`;