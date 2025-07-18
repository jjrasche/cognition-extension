import { ActionRegistry } from "./action-registry.js";
import { OAuthManager } from "./oauth-manager.js";
import { StateStore } from "./state-store.js";

export class ExtensionState extends StateStore{
  constructor() {
    super();
    this.actions = new ActionRegistry();
    this.oauthManager = new OAuthManager();
  }
}
