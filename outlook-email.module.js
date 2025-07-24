export const manifest = {
  name: "outlook-email",
  version: "1.0.0",
  permissions: ["storage"],
  actions: ["listTodayEmails", "readEmail", "showRecentEmail"],
  state: {
    reads: [],
    writes: [
      "outlook.lastSync", 
      "outlook.today.count",
      "outlook.today.list",
      "outlook.recent.subject",
      "outlook.recent.from",
      "outlook.recent.preview"
    ]
  }
};

// OAuth configuration - to be filled after app registration
export const oauth = {
  provider: 'outlook',
  clientId: 'bb8d061d-475b-4aa6-9ef3-90a4908325ee',
  authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
  tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
  scopes: ['Mail.Read', 'User.Read', 'offline_access'],
  redirectUri: 'https://chromiumapp.org/',
  authParams: {
    prompt: 'select_account'  // Forces account selection
  }
};

// Module initialization
export async function initialize(state, config) {
  // Clear any stale data
  await state.write('outlook.today.count', 0);
  await state.write('outlook.today.list', []);
}

// List today's emails
export async function listTodayEmails(state) {
  const token = await state.oauthManager.getToken('outlook');
  if (!token) {
    return { success: false, error: 'Not authenticated with Outlook' };
  }
  
  try {
    const dateFilter = getTodayDateRange();
    const endpoint = `/me/messages?$filter=${dateFilter}&$select=id,subject,from,receivedDateTime,bodyPreview&$orderby=receivedDateTime desc&$top=50`;
    
    const response = await fetch(`https://graph.microsoft.com/v1.0${endpoint}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (!response.ok) throw new Error(`Graph API error: ${response.status}`);
    
    const data = await response.json();
    const emails = data.value || [];
    
    // Transform and store email list
    const emailList = emails.map(email => ({
      id: email.id,
      subject: email.subject,
      from: email.from?.emailAddress?.address || 'Unknown',
      fromName: email.from?.emailAddress?.name || email.from?.emailAddress?.address || 'Unknown',
      receivedAt: email.receivedDateTime,
      preview: email.bodyPreview
    }));
    
    await state.write('outlook.today.count', emailList.length);
    await state.write('outlook.today.list', emailList);
    await state.write('outlook.lastSync', new Date().toISOString());
    
    return { 
      success: true, 
      count: emailList.length,
      emails: emailList
    };
    
  } catch (error) {
    console.error('[Outlook] List emails error:', error);
    return { success: false, error: error.message };
  }
}

// Read specific email by ID
export async function readEmail(state, params) {
  if (!params?.id) {
    return { success: false, error: 'Email ID required' };
  }
  
  const token = await state.oauthManager.getToken('outlook');
  if (!token) {
    return { success: false, error: 'Not authenticated with Outlook' };
  }
  
  try {
    const response = await fetch(`https://graph.microsoft.com/v1.0/me/messages/${params.id}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (!response.ok) {
      if (response.status === 404) {
        return { success: false, error: 'Email not found' };
      }
      throw new Error(`Graph API error: ${response.status}`);
    }
    
    const email = await response.json();
    
    return {
      success: true,
      email: {
        id: email.id,
        subject: email.subject,
        from: email.from?.emailAddress?.address,
        fromName: email.from?.emailAddress?.name,
        to: email.toRecipients?.map(r => r.emailAddress.address),
        receivedAt: email.receivedDateTime,
        body: email.body?.content,
        bodyType: email.body?.contentType
      }
    };
    
  } catch (error) {
    console.error('[Outlook] Read email error:', error);
    return { success: false, error: error.message };
  }
}

// Show most recent email in UI
export async function showRecentEmail(state) {
  // Get emails from state or fetch fresh
  let emails = await state.read('outlook.today.list');
  
  if (!emails || emails.length === 0) {
    const result = await listTodayEmails(state);
    if (!result.success) {
      return result;
    }
    emails = result.emails;
  }
  
  if (!emails || emails.length === 0) {
    await state.write('outlook.recent.subject', 'No emails today');
    await state.write('outlook.recent.from', '');
    await state.write('outlook.recent.preview', '');
    
    await state.actions.execute('ui.notify', {
      message: 'No emails found for today',
      type: 'info'
    });
    
    return { success: true, message: 'No emails today' };
  }
  
  // Get most recent email
  const recent = emails[0];
  
  // Update state
  await state.write('outlook.recent.subject', recent.subject);
  await state.write('outlook.recent.from', recent.fromName);
  await state.write('outlook.recent.preview', recent.preview);
  
  // Show in UI
  const content = `
    <div style="padding: 20px;">
      <h3 style="margin: 0 0 12px 0; color: #fff;">Most Recent Email</h3>
      <div style="background: rgba(255,255,255,0.05); border-radius: 8px; padding: 16px;">
        <div style="font-weight: 600; margin-bottom: 8px;">${globalThis.cognition.escapeHtml(recent.subject)}</div>
        <div style="color: rgba(255,255,255,0.7); font-size: 13px; margin-bottom: 12px;">
          From: ${globalThis.cognition.escapeHtml(recent.fromName)}
        </div>
        <div style="color: rgba(255,255,255,0.8); line-height: 1.5;">
          ${globalThis.cognition.escapeHtml(recent.preview)}
        </div>
        <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid rgba(255,255,255,0.1);">
          <button 
            style="background: rgba(99,102,241,0.2); border: 1px solid rgba(99,102,241,0.5); color: #fff; padding: 6px 12px; border-radius: 4px; cursor: pointer;"
            data-action="outlook.readEmail" 
            data-params='{"id":"${recent.id}"}'>
            Read Full Email
          </button>
        </div>
      </div>
    </div>
  `;
  
  await state.write('ui.content', content);
  await state.actions.execute('ui.show');
  
  return { 
    success: true, 
    email: {
      subject: recent.subject,
      from: recent.fromName,
      preview: recent.preview
    }
  };
}

// Calculate today's date range for filtering
function getTodayDateRange() {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startISO = startOfDay.toISOString();
  const endISO = now.toISOString();
  
  return `receivedDateTime ge ${startISO} and receivedDateTime le ${endISO}`;
}