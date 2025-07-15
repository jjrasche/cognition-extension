// input.module.js - Real-time text input module
export const manifest = {
  name: 'Input',
  version: '1.0.0',
  description: 'Real-time text input through UI overlay',
  permissions: ['storage'],
  actions: ['show', 'hide', 'clear'],
  state: {
    reads: ['ui.content', 'ui.visible'],
    writes: ['input.text.current', 'input.text.active', 'ui.content']
  }
};

// Single-line state update lambdas
const updateTextInput = (value) => chrome.runtime.sendMessage({ type: 'EXECUTE_ACTION', action: 'state.write', params: { key: 'input.text.current', value } });
const showUI = async (state) => await state.actions.execute('ui.show');
const hideUI = async (state) => await state.actions.execute('ui.hide');
const setState = async (v) => await state.writeMany({ 'input.text.current': v.current, 'input.text.active': v.active, 'ui.content': v.content || '' });
const setCurrent = async (state, value) => await state.write('input.text.current', value);
const setContent = async (state, html) => await state.write('ui.content', html);

export const initialize = async (state) => {
  await setState({ current: '', active: false });
};

export const show = async (state, { prompt = 'Enter text:', placeholder = 'Type here...' } = {}) => {
  await showUI(state);
  await setState({ current: '', active: true });
  
  const html = `
    <div style="padding: 20px;">
      <div style="color: rgba(255,255,255,0.9); margin-bottom: 12px; font-size: 16px;">${prompt}</div>
      <input 
        type="text" 
        class="cognition-text-input"
        placeholder="${placeholder}"
        style="width: 100%; padding: 10px 12px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); border-radius: 6px; color: #fff; font-size: 14px; outline: none;"
        onfocus="this.style.borderColor='rgba(99,102,241,0.6)'; this.style.background='rgba(255,255,255,0.15)';"
        onblur="this.style.borderColor='rgba(255,255,255,0.2)'; this.style.background='rgba(255,255,255,0.1)';"
      />
    </div>
    <script>
      let t;
      const updateTextInput = ${updateTextInput.toString()};
      document.querySelector('.cognition-text-input').oninput = e => {
        clearTimeout(t);
        t = setTimeout(() => updateTextInput(e.target.value), 500);
      };
    </script>
  `;
  
  await setContent(state, html);
  return { success: true };
};

export const hide = async (state) => {
  await setState({ active: false, current: '', content: '' });
  await hideUI(state);
  return { success: true };
};

export const clear = async (state) => {
  await setCurrent(state, '');
  const active = await state.read('input.text.active');
  if (active) await setContent(state, (await state.read('ui.content')).replace(/value="[^"]*"/, 'value=""'));
  return { success: true };
};