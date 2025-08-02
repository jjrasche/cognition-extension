export class ActionRegistry {
  constructor() {
    this.actions = new Map();
  }

  register = (moduleName, actionName, handler) => this.actions.set(`${moduleName}.${actionName}`, { handler, moduleName, actionName });
  has = (name) => this.actions.has(name);
  
  async execute(name, params = {}) {
    const action = this.actions.get(name);
    if (!action) throw new Error(`Action not found: ${name}`);
    
    // try {
      return await action.handler(params);
    // } catch (error) {
    //   throw new Error(`Error executing action ${name}`, error);
    // }
  }

  extractFunctionSignature = (func) => {
    const funcString = func.toString();
    const paramMatch = funcString.match(/\(([^)]*)\)/);
    const params = paramMatch ? paramMatch[1].split(',').map(p => p.trim()).filter(Boolean) : [];
    return params
  }

  prettyPrint = () => console.table(
    Object.fromEntries(
      Array.from(this.actions.entries()).map(([name, action]) => [
        name,
        {
          module: action.moduleName,
          action: action.actionName,
          signature: this.extractFunctionSignature(action.handler).join(', ')
        }
      ])
    )
  );
}