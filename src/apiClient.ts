/**
 * HTTP client for the MedDSAgent backend API.
 * Used in the extension host (not in webviews, which call the API directly).
 */

export interface SessionInfo {
    session_id: string;
    name: string;
    last_accessed: string;
}

export interface SessionConfig {
    llm_provider: string;
    llm_model: string;
    llm_api_key?: string;
    llm_base_url?: string;
    llm_api_version?: string;
    temperature: number;
    top_p: number;
    reasoning_effort?: string;
    language: string;
    db_connection_code?: string;
    specialty_id?: string;
    specialty_prompt?: string;
}

export interface SessionDetail extends SessionInfo {
    config: SessionConfig;
}

export interface SpecialtyEntry {
    id: string;
    display_name: string;
}

export interface HealthStatus {
    status: string;
    service: string;
    port: number;
    r_available: boolean;
    python_version: string;
    packages: string[];
}

export interface VariableInfo {
    name: string;
    type: string;
    value: string;
    preview?: string;
    is_error?: boolean;
}

export interface VariablesResponse {
    language: 'python' | 'r';
    python?: VariableInfo[];
    r?: VariableInfo[];
}

export interface FileInfo {
    name: string;
    path: string;
    size: number;
    size_human: string;
    is_directory: boolean;
    modified_at: string;
}

export interface IndexStatus {
    file_name: string;
    status: 'not_indexed' | 'indexing' | 'done' | 'failed';
    section_count: number;
    error_message: string | null;
}

export class ApiClient {
    constructor(public readonly serverUrl: string) {}

    private async _fetch(path: string, options?: RequestInit): Promise<Response> {
        const url = `${this.serverUrl}${path}`;
        const response = await fetch(url, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                ...options?.headers,
            },
        });
        if (!response.ok) {
            const text = await response.text().catch(() => response.statusText);
            throw new Error(`API ${response.status}: ${text}`);
        }
        return response;
    }

    async health(): Promise<HealthStatus> {
        const r = await this._fetch('/health');
        return r.json() as Promise<HealthStatus>;
    }

    async listSessions(): Promise<SessionInfo[]> {
        const r = await this._fetch('/sessions');
        return r.json() as Promise<SessionInfo[]>;
    }

    async getSession(sessionId: string): Promise<SessionDetail> {
        const r = await this._fetch(`/sessions/${sessionId}`);
        return r.json() as Promise<SessionDetail>;
    }

    async createSession(name: string, config: SessionConfig): Promise<{ session_id: string; name: string }> {
        const r = await this._fetch('/sessions', {
            method: 'POST',
            body: JSON.stringify({ name, config }),
        });
        return r.json() as Promise<{ session_id: string; name: string }>;
    }

    async updateSession(sessionId: string, name: string, config: SessionConfig): Promise<void> {
        await this._fetch(`/sessions/${sessionId}`, {
            method: 'PUT',
            body: JSON.stringify({ name, config }),
        });
    }

    async deleteSession(sessionId: string): Promise<void> {
        await this._fetch(`/sessions/${sessionId}`, { method: 'DELETE' });
    }

    async renameSession(sessionId: string, name: string): Promise<void> {
        await this._fetch(`/sessions/${sessionId}/name`, {
            method: 'PUT',
            body: JSON.stringify({ name }),
        });
    }

    async getVariables(sessionId: string): Promise<VariablesResponse> {
        const r = await this._fetch(`/sessions/${sessionId}/variables`);
        return r.json() as Promise<VariablesResponse>;
    }

    async listSpecialtyPrompts(): Promise<SpecialtyEntry[]> {
        const r = await this._fetch('/specialty-prompts');
        return r.json() as Promise<SpecialtyEntry[]>;
    }

    async stopSession(sessionId: string): Promise<void> {
        await this._fetch(`/sessions/${sessionId}/stop`, { method: 'POST' });
    }

    async workspaceInit(): Promise<void> {
        await this._fetch('/workspace/init', { method: 'POST' });
    }

    async listFiles(sessionId: string, subPath = ''): Promise<FileInfo[]> {
        const query = subPath ? `?path=${encodeURIComponent(subPath)}` : '';
        const r = await this._fetch(`/sessions/${sessionId}/files${query}`);
        return r.json() as Promise<FileInfo[]>;
    }

    async indexDocument(sessionId: string, fileName: string, filePath = 'uploads'): Promise<{ status: string; file_name: string; job_id?: string }> {
        const r = await this._fetch(`/sessions/${sessionId}/index`, {
            method: 'POST',
            body: JSON.stringify({ file_name: fileName, path: filePath }),
        });
        return r.json() as Promise<{ status: string; file_name: string; job_id?: string }>;
    }

    async getIndexStatus(sessionId: string, fileName: string): Promise<IndexStatus> {
        const r = await this._fetch(`/sessions/${sessionId}/files/${encodeURIComponent(fileName)}/index-status`);
        return r.json() as Promise<IndexStatus>;
    }
}
