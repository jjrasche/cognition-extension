export const manifest = {
    name: "tree-to-dom",
    context: ["extension-page"],
    version: "1.0.0",
    description: "Transforms nested tree structures to DOM elements with event handling and form serialization",
    permissions: [],
    actions: ["transform"],
};

let runtime;
export const initialize = async (rt) => runtime = rt;

export const transform = async (params) => {
  const { tree, container } = params;
  
  if (!tree || typeof tree !== 'object') {
    throw new Error('Tree must be a valid object');
  }
  
  // Default container or use provided one
  const targetContainer = container || document.body;
  
  // Clear existing content
  targetContainer.innerHTML = '';
  
  // Render each top-level element
  const renderedElements = {};
  Object.entries(tree).forEach(([id, node]) => {
    const element = createElementFromNode(id, node, renderedElements);
    if (element) {
      targetContainer.appendChild(element);
    }
  });
  
  // Bind events after all elements are created
  Object.entries(tree).forEach(([id, node]) => {
    bindNodeEvents(id, node, renderedElements);
  });
  
  return { success: true, elements: renderedElements };
};

// Create DOM element from tree node
const createElementFromNode = (id, node, renderedElements) => {
  if (!node.tag) return null;
  
  // Create the element
  const element = document.createElement(node.tag);
  
  // Set basic attributes
  if (node.text) element.textContent = node.text;
  if (node.class) element.className = node.class;
  if (node.id) element.id = node.id;
  
  // Handle form-specific attributes
  if (node.name) element.name = node.name;
  if (node.type) element.type = node.type;
  if (node.value) element.value = node.value;
  if (node.placeholder) element.placeholder = node.placeholder;
  if (node.required) element.required = node.required;
  
  // Handle select options
  if (node.tag === 'select' && node.options) {
    populateSelectOptions(element, node.options);
  }
  
  // Set other attributes (excluding special properties)
  Object.entries(node).forEach(([key, value]) => {
    if (['tag', 'text', 'class', 'id', 'events', 'data', 'name', 'type', 'value', 'placeholder', 'required', 'options'].includes(key)) return;
    if (typeof value === 'object' && value.tag) return; // Skip nested elements
    
    element.setAttribute(key, value);
  });
  
  // Set data attributes
  if (node.data) {
    Object.entries(node.data).forEach(([key, value]) => {
      element.setAttribute(`data-${key}`, value);
    });
  }
  
  // Process nested children
  Object.entries(node).forEach(([childId, childNode]) => {
    if (typeof childNode === 'object' && childNode.tag) {
      const childElement = createElementFromNode(childId, childNode, renderedElements);
      if (childElement) {
        element.appendChild(childElement);
      }
    }
  });
  
  // Store reference
  renderedElements[id] = element;
  
  return element;
};

// Populate select element with options
const populateSelectOptions = (selectElement, options) => {
  selectElement.innerHTML = '';
  
  options.forEach(opt => {
    const option = document.createElement('option');
    const optionData = typeof opt === 'string' 
      ? { value: opt, text: opt } 
      : { value: opt.value || opt.id, text: opt.text || opt.label || opt.value };
    
    option.value = optionData.value;
    option.textContent = optionData.text;
    if (optionData.selected) option.selected = true;
    
    selectElement.appendChild(option);
  });
};

// Bind events for a node and its children
const bindNodeEvents = (id, node, renderedElements) => {
  const element = renderedElements[id];
  if (!element || !node.events) return;
  
  Object.entries(node.events).forEach(([eventType, handlerName]) => {
    element.addEventListener(eventType, async (event) => {
      // Prevent default for forms unless specified otherwise
      if (eventType === 'submit') {
        event.preventDefault();
      }
      
      // Serialize form data if this is a form or form element
      const eventData = createEventData(event, element);
      
      try {
        await runtime.call(handlerName, eventData);
      } catch (error) {
        runtime.logError(`[TreeTransformer] Event handler failed: ${handlerName}`, error);
      }
    });
  });
  
  // Recursively bind events for children
  Object.entries(node).forEach(([childId, childNode]) => (typeof childNode === 'object' && childNode.tag) && bindNodeEvents(childId, childNode, renderedElements));
};

const createEventData = (event, element) => {
  const data = {
    type: event.type,
    target: {
      tagName: element.tagName.toLowerCase(),
      id: element.id,
      name: element.name,
      value: element.value
    }
  };
  
  // If this is a form event, serialize the entire form
  const form = element.tagName === 'FORM' ? element : element.closest('form');
  if (form) {
    data.formData = serializeForm(form);
  }
  
  return data;
};

// Serialize form data
export const serialize = async (params) => {
  const { formElement } = params;
  return serializeForm(formElement);
};

const serializeForm = (form) => {
  const formData = {};
  const elements = form.querySelectorAll('input, select, textarea');
  
  elements.forEach(element => {
    if (element.name) {
      if (element.type === 'checkbox') {
        formData[element.name] = element.checked;
      } else if (element.type === 'radio') {
        if (element.checked) {
          formData[element.name] = element.value;
        }
      } else {
        formData[element.name] = element.value;
      }
    }
  });
  
  return formData;
};
export const bindEvents = async ({ tree, elements }) => Object.entries(tree).forEach(([id, node]) => bindNodeEvents(id, node, elements))



// // Test suite
// export const test = async () => {
//   const { runUnitTest, deepEqual } = runtime.testUtils;
  
//   const results = await Promise.all([
//     // Basic transformation tests
//     runUnitTest("Simple element transformation", async () => {
//       const tree = { "div-1": { tag: "div", text: "Hello" } };
//       const container = createTestContainer();
      
//       const result = await transform({ tree, container });
//       const element = container.querySelector('div');
      
//       const actual = {
//         success: result.success,
//         hasElement: !!element,
//         text: element?.textContent
//       };
//       return { actual, assert: deepEqual, expected: { success: true, hasElement: true, text: "Hello" } };
//     }),
    
//     runUnitTest("Form elements with attributes", async () => {
//       const tree = {
//         "form-1": {
//           tag: "form",
//           "input-1": {
//             tag: "input",
//             type: "text",
//             name: "username",
//             placeholder: "Enter username",
//             required: true
//           }
//         }
//       };
//       const container = createTestContainer();
      
//       await transform({ tree, container });
//       const input = container.querySelector('input');
      
//       const actual = {
//         type: input?.type,
//         name: input?.name,
//         placeholder: input?.placeholder,
//         required: input?.required
//       };
//       const expected = {
//         type: "text",
//         name: "username", 
//         placeholder: "Enter username",
//         required: true
//       };
//       return { actual, assert: deepEqual, expected };
//     }),
    
//     runUnitTest("Select with options", async () => {
//       const tree = {
//         "select-1": {
//           tag: "select",
//           name: "country",
//           options: [
//             { value: "us", text: "United States" },
//             { value: "ca", text: "Canada", selected: true },
//             "Other"
//           ]
//         }
//       };
//       const container = createTestContainer();
      
//       await transform({ tree, container });
//       const select = container.querySelector('select');
//       const options = select?.querySelectorAll('option');
      
//       const actual = {
//         name: select?.name,
//         optionCount: options?.length,
//         firstText: options?.[0]?.textContent,
//         firstValue: options?.[0]?.value,
//         selectedIndex: select?.selectedIndex,
//         thirdText: options?.[2]?.textContent,
//         thirdValue: options?.[2]?.value
//       };
//       const expected = {
//         name: "country",
//         optionCount: 3,
//         firstText: "United States",
//         firstValue: "us",
//         selectedIndex: 1, // Canada is selected
//         thirdText: "Other",
//         thirdValue: "Other"
//       };
//       return { actual, assert: deepEqual, expected };
//     }),
    
//     // Event handling tests
//     runUnitTest("Click event binding", async () => {
//       const tree = {
//         "btn-1": {
//           tag: "button",
//           text: "Click me",
//           events: { click: "test.mockHandler" }
//         }
//       };
//       const container = createTestContainer();
      
//       // Mock handler that stores call data
//       let mockCalled = false;
//       let mockData = null;
//       mockRuntime.call = async (action, data) => {
//         if (action === 'test.mockHandler') {
//           mockCalled = true;
//           mockData = data;
//         }
//       };
      
//       await transform({ tree, container });
//       const button = container.querySelector('button');
      
//       // Simulate click
//       button?.click();
      
//       // Small delay for async handler
//       await new Promise(resolve => setTimeout(resolve, 10));
      
//       const actual = {
//         mockCalled,
//         eventType: mockData?.type,
//         targetTag: mockData?.target?.tagName
//       };
//       const expected = {
//         mockCalled: true,
//         eventType: "click",
//         targetTag: "button"
//       };
//       return { actual, assert: deepEqual, expected };
//     }),
    
//     runUnitTest("Form serialization on change", async () => {
//       const tree = {
//         "form-1": {
//           tag: "form",
//           events: { change: "test.mockFormHandler" },
//           "username": { tag: "input", name: "username", type: "text" },
//           "email": { tag: "input", name: "email", type: "email" },
//           "active": { tag: "input", name: "active", type: "checkbox" }
//         }
//       };
//       const container = createTestContainer();
      
//       // Mock handler
//       let formData = null;
//       mockRuntime.call = async (action, data) => {
//         if (action === 'test.mockFormHandler') {
//           formData = data.formData;
//         }
//       };
      
//       await transform({ tree, container });
      
//       // Set form values
//       const usernameInput = container.querySelector('input[name="username"]');
//       const emailInput = container.querySelector('input[name="email"]');
//       const activeInput = container.querySelector('input[name="active"]');
      
//       usernameInput.value = "testuser";
//       emailInput.value = "test@example.com";
//       activeInput.checked = true;
      
//       // Trigger change event
//       usernameInput.dispatchEvent(new Event('change', { bubbles: true }));
      
//       // Small delay for async handler
//       await new Promise(resolve => setTimeout(resolve, 10));
      
//       const actual = formData;
//       const expected = {
//         username: "testuser",
//         email: "test@example.com", 
//         active: true
//       };
//       return { actual, assert: deepEqual, expected };
//     }),
    
//     runUnitTest("Form submit with preventDefault", async () => {
//       const tree = {
//         "form-1": {
//           tag: "form",
//           events: { submit: "test.mockSubmitHandler" },
//           "username": { tag: "input", name: "username", type: "text" },
//           "submit-btn": { tag: "button", type: "submit", text: "Submit" }
//         }
//       };
//       const container = createTestContainer();
      
//       // Mock handler
//       let submitCalled = false;
//       let submitFormData = null;
//       mockRuntime.call = async (action, data) => {
//         if (action === 'test.mockSubmitHandler') {
//           submitCalled = true;
//           submitFormData = data.formData;
//         }
//       };
      
//       await transform({ tree, container });
      
//       // Set form value
//       const usernameInput = container.querySelector('input[name="username"]');
//       usernameInput.value = "submituser";
      
//       // Submit form
//       const form = container.querySelector('form');
//       form.dispatchEvent(new Event('submit', { bubbles: true }));
      
//       // Small delay for async handler
//       await new Promise(resolve => setTimeout(resolve, 10));
      
//       const actual = {
//         submitCalled,
//         formData: submitFormData
//       };
//       const expected = {
//         submitCalled: true,
//         formData: { username: "submituser" }
//       };
//       return { actual, assert: deepEqual, expected };
//     }),
    
//     runUnitTest("Nested event binding", async () => {
//       const tree = {
//         "container-1": {
//           tag: "div",
//           "nested-btn": {
//             tag: "button",
//             text: "Nested click",
//             events: { click: "test.mockNestedHandler" }
//           }
//         }
//       };
//       const container = createTestContainer();
      
//       // Mock handler
//       let nestedCalled = false;
//       mockRuntime.call = async (action, data) => {
//         if (action === 'test.mockNestedHandler') {
//           nestedCalled = true;
//         }
//       };
      
//       await transform({ tree, container });
//       const nestedButton = container.querySelector('button');
      
//       // Click nested button
//       nestedButton?.click();
      
//       // Small delay for async handler
//       await new Promise(resolve => setTimeout(resolve, 10));
      
//       const actual = { nestedCalled };
//       const expected = { nestedCalled: true };
//       return { actual, assert: deepEqual, expected };
//     })
//   ]);
  
//   // Cleanup after all tests
//   cleanupTestContainers();
//   restoreRuntime();
  
//   return results.flat();
// };

// // Test utilities
// const createTestContainer = () => {
//   const container = document.createElement('div');
//   container.className = 'test-container';
//   document.body.appendChild(container);
//   return container;
// };

// const cleanupTestContainers = () => {
//   document.querySelectorAll('.test-container').forEach(container => {
//     container.remove();
//   });
// };

// // Mock runtime for testing
// let originalRuntime;
// let mockRuntime = {
//   call: async (action, data) => {
//     // Default mock implementation
//     return { success: true };
//   },
//   logError: (msg, error) => console.error(msg, error)
// };

// // Helper to mock runtime during tests
// const setupMockRuntime = () => {
//   originalRuntime = runtime;
//   runtime = mockRuntime;
// };

// const restoreRuntime = () => {
//   if (originalRuntime) {
//     runtime = originalRuntime;
//   }
// };

// // Auto-setup mock runtime for tests
// if (typeof window !== 'undefined' && window.location?.protocol === 'chrome-extension:') {
//   // In extension context, setup mock when tests start
//   const originalTest = test;
//   const test = async () => {
//     setupMockRuntime();
//     const results = await originalTest();
//     restoreRuntime();
//     return results;
//   };
// }