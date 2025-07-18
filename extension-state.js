import { ActionRegistry } from "action-registry";
import { OAuthManager } from "oauth-manager";
import { StateStore } from "state-store";

export class ExtensionState extends StateStore{
  constructor() {
    super();
    this.actions = new ActionRegistry();
    this.oauthManager = new OAuthManager();
  }
}
