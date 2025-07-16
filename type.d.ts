// types.d.ts
interface ModuleManifest {
    name: string;
    version: string;
    permissions: string[];
    actions: string[];
    state: {
        reads: string[];
        writes: string[];
    };
}
interface OAuthConfig {
    provider: string;
    clientId: string;
    clientSecret?: string;
    authUrl: string;
    tokenUrl: string;
    scopes: string[];
    redirectUri: string;
    authParams?: Record<string, string>;
}
interface CognitionModule {
    manifest: ModuleManifest;
    oauth?: OAuthConfig;
    initialize(state: StateStore, config: any): Promise<void>;
    cleanup?(): Promise<void>;
    tests?: Array<{
        name: string;
        fn: () => Promise<void>;
    }>;
    [key: string]: any; // For module actions
}
interface ActionRegistry {
    register(name: string, handler: Function, metadata?: any): void;
    execute(name: string, params?: any): Promise<any>;
    list(): Array<any>;
    has(name: string): boolean;
}
interface StateStore {
    read(key: string): Promise<any>;
    write(key: string, value: any): Promise<void>;
    writeMany(updates: Record<string, any>): Promise<void>;
    remove(key: string): Promise<void>;
    watch(pattern: string, callback: (value: any) => void): () => void;
    getAll(): Promise<Record<string, any>>;
    clear(): Promise<void>;
    actions: ActionRegistry;
    oauthManager: OAuthManager;
}
interface OAuthManager {
    register(provider: string, config: OAuthConfig): void;
    getToken(provider: string): Promise<string | null>;
    startAuth(provider: string): Promise<any>;
    handleCallback(callbackUrl: string): Promise<any>;
    clearTokens(provider: string): Promise<void>;
    isAuthenticated(provider: string): boolean;
}
// Declare module types to fix the TypeScript errors
declare module "*.module.js" {
    const module: CognitionModule;
    export = module;
}