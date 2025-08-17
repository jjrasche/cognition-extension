export const manifest = {
  name: "web-tree-to-dom",
  context: ["extension-page"],
  version: "1.0.0",
  description: "Transforms web tree structures to DOM with event handling",
  permissions: [],
  actions: ["transform"],
};

let runtime;
export const initialize = async (rt) => runtime = rt;

export const transform = async ({ tree, container }) => {
  if (!tree || typeof tree !== 'object') throw new Error('Tree must be valid object');
  const target = container || document.body;
  target.innerHTML = '';
  const elements = {};
  Object.entries(tree).forEach(([id, node]) => createElement(id, node, elements, target));
  Object.entries(tree).forEach(([id, node]) => bindNodeEvents(id, node, elements));
  return elements;
};
const createElement = (id, node, elements, parent) => {
  if (!node.tag) return;
  const el = document.createElement(node.tag);
  setProps(el, node);
  if (node.tag === 'select' && node.options) populateOptions(el, node.options);
  Object.entries(node).forEach(([childId, child]) => 
    typeof child === 'object' && child.tag && createElement(childId, child, elements, el));
  elements[id] = el;
  parent.appendChild(el);
};
const setProps = (el, node) => (setBasicProps(el, node), setFormProps(el, node), setDataProps(el, node), setOtherProps(el, node));
const setBasicProps = (el, node) => (setTextProp(el, node), setClassProp(el, node), setIdProp(el, node));
const setTextProp = (el, node) => node.text && (el.textContent = node.text);
const setClassProp = (el, node) => node.class && (el.className = node.class);
const setIdProp = (el, node) => node.id && (el.id = node.id);
const setFormProps = (el, node) => ['name', 'type', 'value', 'placeholder', 'required'].forEach(prop => node[prop] && (el[prop] = node[prop]));
const setDataProps = (el, node) => node.data && Object.entries(node.data).forEach(([key, value]) => el.setAttribute(`data-${key}`, value));
const specialProps = new Set(['tag', 'text', 'class', 'id', 'events', 'data', 'name', 'type', 'value', 'placeholder', 'required', 'options']);
const setOtherProps = (el, node) => Object.entries(node).forEach(([key, value]) => !specialProps.has(key) && !(typeof value === 'object' && value.tag) && el.setAttribute(key, value));
const populateOptions = (select, options) => {
  select.innerHTML = '';
  options.forEach(opt => {
    const option = document.createElement('option');
    const data = typeof opt === 'string' ? { value: opt, text: opt } : { value: opt.value || opt.id, text: opt.text || opt.label || opt.value };
    option.value = data.value;
    option.textContent = data.text;
    if (data.selected) option.selected = true;
    select.appendChild(option);
  });
};
const bindNodeEvents = (id, node, elements) => {
  const el = elements[id];
  if (!el || !node.events) return;
  Object.entries(node.events).forEach(([event, handler]) => 
    el.addEventListener(event, async (e) => {
      if (event === 'submit') e.preventDefault();
      try { await runtime.call(handler, createEventData(e, el)); }
      catch (error) { runtime.logError(`Event handler failed: ${handler}`, error); }
    }));
  Object.entries(node).forEach(([childId, child]) => 
    typeof child === 'object' && child.tag && bindNodeEvents(childId, child, elements));
};
const createEventData = (event, element) => {
  const form = element.tagName === 'FORM' ? element : element.closest('form');
  return {
    type: event.type,
    target: { tagName: element.tagName.toLowerCase(), id: element.id, name: element.name, value: element.value }, ...(form && { formData: serializeForm(form) })
  };
};
const serializeForm = (form) => {
  const data = {};
  form.querySelectorAll('input, select, textarea').forEach(el => {
    if (!el.name) return;
    if (el.type === 'checkbox') data[el.name] = el.checked;
    else if (el.type === 'radio') { if (el.checked) data[el.name] = el.value; }
    else data[el.name] = el.value;
  });
  return data;
};

// testing
export const test = async () => {
  console.log('Running web-tree-to-dom tests...');
  const { runUnitTest } = runtime.testUtils;
  return (await Promise.all([
    runUnitTest("Simple element creation", async () => {
      const divObj = { tag: "div", id: "div-1", class: "test-class", text: "Hello World" };
      const tree = { [divObj.id]: divObj };
      return await run(tree, [divObj]);
    }),
    runUnitTest("Multiple independent elements", async () => {
      const divObj = { tag: "div", id: "parent-div", class: "container", text: "Parent" };
      const spanObj = { tag: "span", id: "child-span", text: "Child" };
      const tree = { [divObj.id]: divObj, [spanObj.id]: spanObj };
      return await run(tree, [divObj, spanObj]);
    }),
    runUnitTest("Form input element", async () => {
      const inputObj = { tag: "input", id: "username-input", type: "text", name: "username", value: "test-value" };
      const tree = { [inputObj.id]: inputObj };
      return await run(tree, [inputObj]);
    }),
    runUnitTest("Select element basic", async () => {
      const selectObj = { tag: "select", id: "country-select", name: "country" };
      const tree = { [selectObj.id]: selectObj };
      return await run(tree, [selectObj]);
    }),
    runUnitTest("Elements with no class or text", async () => {
      const inputObj = { tag: "input", id: "email-field", type: "email" };
      const buttonObj = { tag: "button", id: "submit-btn" };
      const tree = { [inputObj.id]: inputObj, [buttonObj.id]: buttonObj };
      return await run(tree, [inputObj, buttonObj]);
    }),
    runUnitTest("Textarea element", async () => {
      const textareaObj = { tag: "textarea", id: "message-area", class: "form-control", text: "Default text" };
      const tree = { [textareaObj.id]: textareaObj };
      return await run(tree, [textareaObj]);
    }),
    runUnitTest("Mixed form elements", async () => {
      const inputObj = { tag: "input", id: "name-input", class: "required", type: "text" };
      const selectObj = { tag: "select", id: "age-select", class: "dropdown" };
      const buttonObj = { tag: "button", id: "save-btn", class: "btn-primary", text: "Save" };
      const tree = { [inputObj.id]: inputObj, [selectObj.id]: selectObj, [buttonObj.id]: buttonObj };
      return await run(tree, [inputObj, selectObj, buttonObj]);
    })
  ])).flat();
};
const run = async (tree, elements) => {
  const container = createTestContainer();
  await transform({ tree, container }); // act
  const actual = elements.map(el => {
      const domEl = container.querySelector(`#${el.id}`);
      return { hasElement: !!domEl, id: domEl?.id, class: domEl?.className, text: domEl?.textContent };
  });
  const expected = elements.map(el => ({ hasElement: true, id: el.id, class: el.class, text: el.text }));
  cleanupTestContainer(container);
  return { actual, assert: runtime.testUtils.deepEqual, expected };
};
const createTestContainer = () => (container => (document.body.appendChild(container), container))(Object.assign(document.createElement('div'), { className: 'test-container' }));
const cleanupTestContainer = (container) => container?.parentNode?.removeChild(container);