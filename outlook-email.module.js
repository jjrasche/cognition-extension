export const manifest = {
	name: "outlook-email",
	version: "1.0.0",
	permissions: ["storage"],
	actions: ["listEmails", "readEmail"],
};
let runtime, log;
export const initialize = (rt, l) => {
	runtime = rt;
	log = l;
};
export async function listEmails() {
	const data = await getData(`/me/messages?$select=id,subject,from,receivedDateTime,bodyPreview&$orderby=receivedDateTime desc&$top=100`);
	return (data.value || []).map(formatEmail);
}
export async function readEmail(params) {
	if (!params?.id) return { success: false, error: 'Email ID required' };
	const data = await getData(`/me/messages?$select=id,subject,from,receivedDateTime,bodyPreview&$orderby=receivedDateTime desc&$top=100`);
	const email = await data.json();
	return formatEmail(email);
}

const formatEmail = (email) => ({
	id: email.id,
	subject: email.subject,
	from: email.from?.emailAddress?.address || 'Unknown',
	fromName: email.from?.emailAddress?.name || email.from?.emailAddress?.address || 'Unknown',
	to: email.toRecipients?.map(r => r.emailAddress.address) || [],
	receivedAt: email.receivedDateTime,
	preview: email.bodyPreview,
	body: email.body?.content,
	bodyType: email.body?.contentType
})
const getData = async (endpoint) => {
	const response = await runtime.call('oauth.request', 'outlook', `https://graph.microsoft.com/v1.0/${endpoint}`);
	if (!response.ok) throw new Error(`Graph API error: ${response.status}`);
	return response.json();
};
export const oauth = {
	provider: 'outlook',
	authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
	tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
	scopes: ['Mail.Read', 'User.Read', 'offline_access'],
	redirectUri: 'https://chromiumapp.org/',
	authParams: { prompt: 'select_account' }
};