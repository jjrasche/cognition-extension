/*
const exampleTree = {
  "form": { 
    tag: "form",
    "provider-label": { tag: "label", text: "Provider:", class: "form-label" },
    "provider-select": { tag: "select", name: "providerName", options: providerOptions },
    "model-label": { tag: "label", text: "Model:", class: "form-label" },
    "model-select": { tag: "select", name: "modelName", dependsOn: "provider-select" },
    "submit-btn": { tag: "button", type: "submit", text: "Select Model" }
  }
};
*/
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
    const { runUnitTest } = runtime.testUtils;
    let runtimeCalls = [];
    const origRuntimeCall = runtime.call;
    const defaultRuntimeCall = async (action, data) => { runtimeCalls.push({ action, data }); };
    runtime.call = defaultRuntimeCall;
    const results = (await Promise.all([
        // basic element creation tests
        runUnitTest("Simple element creation", async () => {
            const divObj = { tag: "div", id: "div-1", class: "test-class", text: "Hello World" };
            const tree = { [divObj.id]: divObj };
            return await testDOMStructure(tree, [divObj]);
        }),
        runUnitTest("Multiple independent elements", async () => {
            const divObj = { tag: "div", id: "parent-div", class: "container", text: "Parent" };
            const spanObj = { tag: "span", id: "child-span", text: "Child" };
            const tree = { [divObj.id]: divObj, [spanObj.id]: spanObj };
            return await testDOMStructure(tree, [divObj, spanObj]);
        }),
        runUnitTest("Form input element", async () => {
            const inputObj = { tag: "input", id: "username-input", type: "text", name: "username", value: "test-value" };
            const tree = { [inputObj.id]: inputObj };
            return await testDOMStructure(tree, [inputObj]);
        }),
        runUnitTest("Select element basic", async () => {
            const selectObj = { tag: "select", id: "country-select", name: "country" };
            const tree = { [selectObj.id]: selectObj };
            return await testDOMStructure(tree, [selectObj]);
        }),
        runUnitTest("Elements with no class or text", async () => {
            const inputObj = { tag: "input", id: "email-field", type: "email" };
            const buttonObj = { tag: "button", id: "submit-btn" };
            const tree = { [inputObj.id]: inputObj, [buttonObj.id]: buttonObj };
            return await testDOMStructure(tree, [inputObj, buttonObj]);
        }),
        runUnitTest("Textarea element", async () => {
            const textareaObj = { tag: "textarea", id: "message-area", class: "form-control", text: "Default text" };
            const tree = { [textareaObj.id]: textareaObj };
            return await testDOMStructure(tree, [textareaObj]);
        }),
        runUnitTest("Mixed form elements", async () => {
            const inputObj = { tag: "input", id: "name-input", class: "required", type: "text" };
            const selectObj = { tag: "select", id: "age-select", class: "dropdown" };
            const buttonObj = { tag: "button", id: "save-btn", class: "btn-primary", text: "Save" };
            const tree = { [inputObj.id]: inputObj, [selectObj.id]: selectObj, [buttonObj.id]: buttonObj };
            return await testDOMStructure(tree, [inputObj, selectObj, buttonObj]);
        }),
        // hierarchy tests
        runUnitTest("Simple parent-child nesting", async () => {
            const parentObj = { tag: "div", id: "parent", class: "wrapper" };
            const childObj = { tag: "span", id: "child", text: "Child text" };
            const tree = { [parentObj.id]: { ...parentObj, [childObj.id]: childObj } };
            return await testDOMStructure(tree, [parentObj, childObj]);
        }),
        runUnitTest("Multiple children same parent", async () => {
            const listObj = { tag: "ul", id: "list" };
            const item1Obj = { tag: "li", id: "item1", text: "First" };
            const item2Obj = { tag: "li", id: "item2", text: "Second" };
            const item3Obj = { tag: "li", id: "item3", text: "Third" };
            const tree = { [listObj.id]: { ...listObj, [item1Obj.id]: item1Obj, [item2Obj.id]: item2Obj, [item3Obj.id]: item3Obj } };
            return await testDOMStructure(tree, [listObj, item1Obj, item2Obj, item3Obj]);
        }),
        runUnitTest("Deep nesting hierarchy", async () => {
            const mainObj = { tag: "section", id: "main" };
            const contentObj = { tag: "div", id: "content" };
            const postObj = { tag: "article", id: "post" };
            const titleObj = { tag: "h2", id: "title", text: "Post Title" };
            const bodyObj = { tag: "p", id: "body", text: "Post content here" };
            const tree = { [mainObj.id]: { ...mainObj, [contentObj.id]: { ...contentObj, [postObj.id]: { ...postObj, [titleObj.id]: titleObj, [bodyObj.id]: bodyObj } } } };
            return await testDOMStructure(tree, [mainObj, contentObj, postObj, titleObj, bodyObj]);
        }),
        runUnitTest("Form with nested structure", async () => {
            const formObj = { tag: "form", id: "signup-form" };
            const fieldsetObj = { tag: "fieldset", id: "personal-info" };
            const legendObj = { tag: "legend", id: "legend", text: "Personal Information" };
            const groupObj = { tag: "div", id: "name-group" };
            const labelObj = { tag: "label", id: "name-label", text: "Name:" };
            const fieldObj = { tag: "input", id: "name-field", type: "text" };
            const tree = { [formObj.id]: { ...formObj, [fieldsetObj.id]: { ...fieldsetObj, [legendObj.id]: legendObj, [groupObj.id]: { ...groupObj, [labelObj.id]: labelObj, [fieldObj.id]: fieldObj } } } };
            return await testDOMStructure(tree, [formObj, fieldsetObj, legendObj, groupObj, labelObj, fieldObj]);
        }),
        runUnitTest("Mixed content hierarchy", async () => {
            const containerObj = { tag: "div", id: "container", text: "Some text before" };
            const boldObj = { tag: "strong", id: "bold", text: "bold text" };
            const italicObj = { tag: "em", id: "italic", text: "italic text" };
            const tree = { [containerObj.id]: { ...containerObj, [boldObj.id]: boldObj, [italicObj.id]: italicObj } };
            return await testDOMStructure(tree, [containerObj, boldObj, italicObj]);
        })
    ])).flat();
    results.push(await runUnitTest("Event Binding: Form submit with serialization and preventDefault", async () => {
        const formObj = { tag: "form", id: "test-form", events: { submit: "test.handleSubmit" } };
        const nameInputObj = { tag: "input", name: "username", value: "testuser", type: "text" };
        const emailInputObj = { tag: "input", name: "email", value: "test@example.com", type: "email" };
        const submitBtnObj = { tag: "button", type: "submit", text: "Submit" };
        const tree = { [formObj.id]: { ...formObj, "name-input": nameInputObj, "email-input": emailInputObj, "submit-btn": submitBtnObj } };
        runtimeCalls = [];
        await initiateEventOnTestDom(tree, [[`#${formObj.id}`, new Event('submit', { bubbles: true, cancelable: true })]]);
        const actual = { action: runtimeCalls[0]?.action, formData: runtimeCalls[0]?.data?.formData };
        const expected = { action: formObj.events.submit, formData: { username: nameInputObj.value, email: emailInputObj.value } };
        return { actual, assert: runtime.testUtils.deepEqual, expected };
    }));
    results.push(await runUnitTest("Event Binding: Click calls action", async () => {
        const buttonObj = { tag: "button", id: "test-btn", events: { click: "test.handleClick" } };
        const tree = { [buttonObj.id]: buttonObj };
        runtimeCalls = [];
        await initiateEventOnTestDom(tree, [[`#${buttonObj.id}`, new Event('click')]]);
        const actual = { action: runtimeCalls[0]?.action };
        const expected = { action: buttonObj.events.click };
        return { actual, assert: runtime.testUtils.deepEqual, expected };
    }));
    results.push(await runUnitTest("Event Binding: Input change passes value", async () => {
        const inputObj = { tag: "input", id: "test-input", name: "testField", events: { change: "test.handleChange" } };
        const tree = { [inputObj.id]: inputObj };
        runtimeCalls = [];
        await initiateEventOnTestDom(tree, [[`#${inputObj.id}`, new Event('change'), "newValue"]]);
        const actual = { action: runtimeCalls[0]?.action, value: runtimeCalls[0]?.data?.target?.value };
        const expected = { action: inputObj.events.change, value: "newValue" };
        return { actual, assert: runtime.testUtils.deepEqual, expected };
    }));
    results.push(await runUnitTest("Event Binding: Multiple events same element", async () => {
        const buttonObj = { tag: "button", id: "multi-btn", events: { click: "test.click", focus: "test.focus" } };
        const tree = { [buttonObj.id]: buttonObj };
        runtimeCalls = [];
        await initiateEventOnTestDom(tree, [[`#${buttonObj.id}`, new Event('click')], [`#${buttonObj.id}`, new Event('focus')]]);
        const actual = runtimeCalls.map(call => call.action);
        const expected = [buttonObj.events.click, buttonObj.events.focus];
        return { actual, assert: runtime.testUtils.deepEqual, expected };
    }));
    results.push(await runUnitTest("Event Binding: Event data structure", async () => {
        const inputObj = { tag: "input", id: "data-input", name: "dataField", events: { change: "test.dataCheck" } };
        const tree = { [inputObj.id]: inputObj };
        runtimeCalls = [];
        await initiateEventOnTestDom(tree, [[`#${inputObj.id}`, new Event('change')]]);
        const eventData = runtimeCalls[0]?.data;
        const actual = { hasType: !!eventData?.type, hasTarget: !!eventData?.target, targetId: eventData?.target?.id };
        const expected = { hasType: true, hasTarget: true, targetId: inputObj.id };
        return { actual, assert: runtime.testUtils.deepEqual, expected };
    }));
    results.push(await runUnitTest("Event Binding: Invalid action graceful error", async () => {
        const buttonObj = { tag: "button", id: "error-btn", events: { click: "nonexistent.action" } };
        const tree = { [buttonObj.id]: buttonObj };
        runtime.call = async () => { };
        runtimeCalls = [];
        await initiateEventOnTestDom(tree, [[`#${buttonObj.id}`, new Event('click')]]);
        const actual = { didNotCrash: true, noCallsMade: runtimeCalls.length === 0 };
        const expected = { didNotCrash: true, noCallsMade: true };
        runtime.call = defaultRuntimeCall;
        return { actual, assert: runtime.testUtils.deepEqual, expected };
    }));
    runtime.call = origRuntimeCall;
    return results;
};
const initiateEventOnTestDom = async (tree, events) => {
    const container = await createTestDOM(tree);
    events.forEach(([selector, event]) => {
        const element = container.querySelector(selector);
        if (element) {
            if (event.type === 'change') element.value = "newValue";
            element.dispatchEvent(event);
        }
    });
    // await new Promise(resolve => setTimeout(resolve, 100)); // small delay for async handlers
    cleanupTestContainer(container);
};  
const createTestDOM = async (tree) => {
    const container = createTestContainer();
    await transform({ tree, container });
    return container;
};
const testDOMStructure = async (tree, elements) => {
    const container = await createTestDOM(tree);
    const actual = elements.map(el => {
        const domEl = container.querySelector(`#${el.id}`);
        return { hasElement: !!domEl, id: domEl?.id, class: el.class ? domEl?.className : undefined, text: el.text ? getDirectText(domEl) : undefined };
    });
    const expected = elements.map(el => ({ hasElement: true, id: el.id, class: el.class, text: el.text }));
    cleanupTestContainer(container);
    return { actual, assert: runtime.testUtils.deepEqual, expected };
};
// default behavior of el.textContent is to combine all text from child nodes
const getDirectText = (element) => Array.from(element.childNodes).filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent).join('');
const createTestContainer = () => (container => (document.body.appendChild(container), container))(Object.assign(document.createElement('div'), { className: 'test-container' }));
const cleanupTestContainer = (container) => container?.parentNode?.removeChild(container);
