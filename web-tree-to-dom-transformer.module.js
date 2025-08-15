export const manifest = {
    name: "web-tree-to-dom-transformer",
    context: ["extension-page"],
    version: "1.0.0",
    description: "Transforms nested web trees into DOM elements",
    permissions: [],
    actions: ["convertTreeToDOM"],
};

let runtime;
export const initialize = async (rt) => runtime = rt;

// Main rendering function
export const convertTreeToDOM = async (params) => {
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

    // Set other attributes
    Object.entries(node).forEach(([key, value]) => {
        if (['tag', 'text', 'class', 'id', 'events', 'data'].includes(key)) return;
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

// Test suite
export const test = async () => {
    const { runUnitTest, strictEqual, deepEqual } = runtime.testUtils;

    const results = await Promise.all([
        runUnitTest("Simple element with tag only", async () => {
            const tree = { "div-1": { tag: "div" } };
            const container = createTestContainer();
            await renderTree({ tree, container });
            const element = container.querySelector('div');
            return { assert: !!element && element.tagName.toLowerCase() === 'div' };
        }),

        // runUnitTest("Element with text content", async () => {
        //   const tree = { "p-1": { tag: "p", text: "Hello world" } };
        //   const container = createTestContainer();

        //   await renderTree({ tree, container });

        //   const element = container.querySelector('p');
        //   const actual = element?.textContent;
        //   return { actual, assert: strictEqual, expected: "Hello world" };
        // }),

        // runUnitTest("Element with CSS class", async () => {
        //   const tree = { "btn-1": { tag: "button", class: "primary-btn" } };
        //   const container = createTestContainer();

        //   await renderTree({ tree, container });

        //   const element = container.querySelector('button');
        //   const actual = element?.className;
        //   return { actual, assert: strictEqual, expected: "primary-btn" };
        // }),

        // runUnitTest("Element with multiple attributes", async () => {
        //   const tree = { 
        //     "input-1": { 
        //       tag: "input", 
        //       type: "text", 
        //       placeholder: "Enter name",
        //       class: "form-input",
        //       data: { testid: "username-input" }
        //     } 
        //   };
        //   const container = createTestContainer();

        //   await renderTree({ tree, container });

        //   const element = container.querySelector('input');
        //   const actual = {
        //     type: element?.type,
        //     placeholder: element?.placeholder,
        //     class: element?.className,
        //     dataTestid: element?.getAttribute('data-testid')
        //   };
        //   const expected = {
        //     type: "text",
        //     placeholder: "Enter name", 
        //     class: "form-input",
        //     dataTestid: "username-input"
        //   };
        //   return { actual, assert: deepEqual, expected };
        // }),

        // // Nested Hierarchy Tests
        // runUnitTest("Two-level nesting", async () => {
        //   const tree = {
        //     "div-1": {
        //       tag: "div",
        //       "p-1": {
        //         tag: "p",
        //         text: "child content"
        //       }
        //     }
        //   };
        //   const container = createTestContainer();

        //   await renderTree({ tree, container });

        //   const parent = container.querySelector('div');
        //   const child = parent?.querySelector('p');
        //   const actual = {
        //     parentExists: !!parent,
        //     childExists: !!child,
        //     childText: child?.textContent,
        //     childParent: child?.parentElement?.tagName.toLowerCase()
        //   };
        //   const expected = {
        //     parentExists: true,
        //     childExists: true,
        //     childText: "child content",
        //     childParent: "div"
        //   };
        //   return { actual, assert: deepEqual, expected };
        // }),

        // runUnitTest("Three-level nesting", async () => {
        //   const tree = {
        //     "section-1": {
        //       tag: "section",
        //       "div-1": {
        //         tag: "div",
        //         "span-1": {
        //           tag: "span",
        //           text: "deeply nested"
        //         }
        //       }
        //     }
        //   };
        //   const container = createTestContainer();

        //   await renderTree({ tree, container });

        //   const section = container.querySelector('section');
        //   const div = section?.querySelector('div');
        //   const span = div?.querySelector('span');
        //   const actual = {
        //     levels: !!section && !!div && !!span,
        //     text: span?.textContent,
        //     hierarchy: span?.parentElement?.parentElement?.tagName.toLowerCase()
        //   };
        //   const expected = {
        //     levels: true,
        //     text: "deeply nested",
        //     hierarchy: "section"
        //   };
        //   return { actual, assert: deepEqual, expected };
        // }),

        // runUnitTest("Multiple siblings", async () => {
        //   const tree = {
        //     "list-1": {
        //       tag: "ul",
        //       "item-1": {
        //         tag: "li",
        //         text: "First item"
        //       },
        //       "item-2": {
        //         tag: "li", 
        //         text: "Second item"
        //       },
        //       "item-3": {
        //         tag: "li",
        //         text: "Third item"
        //       }
        //     }
        //   };
        //   const container = createTestContainer();

        //   await renderTree({ tree, container });

        //   const ul = container.querySelector('ul');
        //   const items = ul?.querySelectorAll('li');
        //   const actual = {
        //     itemCount: items?.length,
        //     firstText: items?.[0]?.textContent,
        //     secondText: items?.[1]?.textContent,
        //     thirdText: items?.[2]?.textContent
        //   };
        //   const expected = {
        //     itemCount: 3,
        //     firstText: "First item",
        //     secondText: "Second item", 
        //     thirdText: "Third item"
        //   };
        //   return { actual, assert: deepEqual, expected };
        // }),

        // runUnitTest("Mixed content - text and children", async () => {
        //   const tree = {
        //     "article-1": {
        //       tag: "article",
        //       text: "Article title",
        //       "p-1": {
        //         tag: "p",
        //         text: "Article content"
        //       }
        //     }
        //   };
        //   const container = createTestContainer();

        //   await renderTree({ tree, container });

        //   const article = container.querySelector('article');
        //   const paragraph = article?.querySelector('p');

        //   // When an element has both text and children, text should be preserved
        //   const actual = {
        //     hasArticle: !!article,
        //     hasParagraph: !!paragraph,
        //     paragraphText: paragraph?.textContent,
        //     // Article should contain both its text and child content
        //     articleContainsText: article?.textContent?.includes("Article title"),
        //     articleContainsChild: article?.textContent?.includes("Article content")
        //   };
        //   const expected = {
        //     hasArticle: true,
        //     hasParagraph: true,
        //     paragraphText: "Article content",
        //     articleContainsText: true,
        //     articleContainsChild: true
        //   };
        //   return { actual, assert: deepEqual, expected };
        // })
    ]);

    // Cleanup after all tests
    cleanupTestContainers();

    return results.flat();
};

// Test utilities
const createTestContainer = () => {
    const container = document.createElement('div');
    container.className = 'test-container';
    document.body.appendChild(container);
    return container;
};

const cleanupTestContainers = () => {
    document.querySelectorAll('.test-container').forEach(container => {
        container.remove();
    });
};