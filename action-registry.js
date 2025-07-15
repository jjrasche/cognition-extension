class ActionRegistry {
  constructor() {
    this.actions = new Map();
  }
  
  register(name, handler, metadata = {}) {
    this.actions.set(name, { handler, metadata, name});
  }
  
  async execute(name, params = {}) {
    const action = this.actions.get(name);
    if (!action) throw new Error(`Action not found: ${name}`);
    
    try {
      const result = await action.handler(params);
      console.log(`[ActionRegistry] Executing action: ${name}`, params);
      return { success: true, result };
    } catch (error) {
      console.error(`[ActionRegistry] Action ${name} failed:`, error);
      return { success: false, error: error.message };
    }
  }

  list = () => Array.from(this.actions.entries()).map(([name, action]) => ({ name, ...action.metadata }));
  has = (name) => this.actions.has(name);
}