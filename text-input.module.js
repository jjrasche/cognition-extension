export const manifest = {
  name: 'textInput',
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

export const initialize = async (state) => await setState({ current: '', active: false })

export const show = async (state, { prompt = 'Enter text:', placeholder = 'Type here...' } = {}) => {
  await showUI(state);
  await setState({ current: '', active: true });
  const html = `
    <div style="padding: 20px;">
      <div style="color: rgba(255,255,255,0.9); margin-bottom: 12px; font-size: 16px;">${globalThis.escapeHtml(prompt)}</div>
      <input 
        type="text" 
        class="cognition-text-input"
        placeholder="${globalThis.escapeHtml(placeholder)}"
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

// Tests
export const tests = [
  {
    name: 'show() updates all required state and calls ui.show',
    fn: async () => {
      const state = createMockState();
      let uiShowCalled = false;
      state.actions.execute = async (action) => {
        if (action === 'ui.show') uiShowCalled = true;
        return { success: true };
      };
      
      await show(state, { prompt: 'Test prompt', placeholder: 'Test placeholder' });
      
      assert(uiShowCalled, 'Should call ui.show');
      assert(state.data['input.text.active'] === true, 'Should set active to true');
      assert(state.data['input.text.current'] === '', 'Should clear current text');
      assert(state.data['ui.content'].includes('Test prompt'), 'Should include prompt in HTML');
      assert(state.data['ui.content'].includes('Test placeholder'), 'Should include placeholder');
      assert(state.data['ui.content'].includes('updateTextInput'), 'Should include update function');
    }
  },
  
  {
    name: 'hide() clears state and calls ui.hide',
    fn: async () => {
      const state = createMockState();
      state.data['input.text.current'] = 'existing text';
      state.data['input.text.active'] = true;
      
      let uiHideCalled = false;
      state.actions.execute = async (action) => {
        if (action === 'ui.hide') uiHideCalled = true;
        return { success: true };
      };
      
      await hide(state);
      
      assert(uiHideCalled, 'Should call ui.hide');
      assert(state.data['input.text.active'] === false, 'Should set active to false');
      assert(state.data['input.text.current'] === '', 'Should clear current text');
      assert(state.data['ui.content'] === '', 'Should clear UI content');
    }
  },
  
  {
    name: 'clear() updates current text and modifies HTML if active',
    fn: async () => {
      const state = createMockState();
      state.data['input.text.current'] = 'some text';
      state.data['input.text.active'] = true;
      state.data['ui.content'] = '<input value="old value" />';
      
      await clear(state);
      
      assert(state.data['input.text.current'] === '', 'Should clear current text');
      assert(state.data['ui.content'].includes('value=""'), 'Should clear input value in HTML');
    }
  },
  
  {
    name: 'clear() only updates state when inactive',
    fn: async () => {
      const state = createMockState();
      state.data['input.text.current'] = 'some text';
      state.data['input.text.active'] = false;
      const originalContent = '<input value="should not change" />';
      state.data['ui.content'] = originalContent;
      
      await clear(state);
      
      assert(state.data['input.text.current'] === '', 'Should clear current text');
      assert(state.data['ui.content'] === originalContent, 'Should not modify HTML when inactive');
    }
  },
  
  {
    name: 'handles edge case inputs safely',
    fn: async () => {
      const state = createMockState();
      
      // XSS attempt in prompt
      await show(state, { prompt: '<script>alert(1)</script>', placeholder: '"quotes" & ampersand' });
      const content = state.data['ui.content'];
      
      assert(content.includes('&lt;script&gt;'), 'Should escape script tags');
      assert(content.includes('&quot;quotes&quot;'), 'Should escape quotes');
      assert(content.includes('&amp;'), 'Should escape ampersands');
      
      // Empty params
      await show(state);
      assert(state.data['ui.content'].includes('Enter text:'), 'Should use default prompt');
      assert(state.data['ui.content'].includes('Type here...'), 'Should use default placeholder');
    }
  },
  
  {
    name: 'initialize sets default state',
    fn: async () => {
      const state = createMockState();
      await initialize(state);
      
      assert(state.data['input.text.current'] === '', 'Should initialize current as empty');
      assert(state.data['input.text.active'] === false, 'Should initialize as inactive');
    }
  }
];

// Test helpers
const createMockState = () => ({
  data: {},
  async read(key) { return this.data[key]; },
  async write(key, value) { this.data[key] = value; },
  async writeMany(updates) { Object.assign(this.data, updates); },
  actions: {
    execute: async (action) => ({ success: true })
  }
});

const assert = (condition, message) => {
  if (!condition) throw new Error(message || 'Assertion failed');
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