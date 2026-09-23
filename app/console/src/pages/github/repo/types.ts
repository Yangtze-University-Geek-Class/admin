// 仓库详情接口的前端形状（服务端 app/server/src/routes/admin/repos.ts）。
export type Branch = { name: string; protected: boolean };
export type Collaborator = { login: string; avatar_url: string | null; role: string };
export type Hook = { id: number; name: string; active: boolean; url?: string };
export type RepoInfo = { name: string; description: string | null; visibility: string; archived: boolean; default_branch: string; html_url: string };
export type RepoResponse = { info: RepoInfo; branches: Branch[]; collaborators: Collaborator[]; hooks: Hook[] };

export type Label = { name: string; color: string };
export type Person = { login?: string; avatar_url?: string | null };
export type Comment = { id: number; body: string | null; created_at: string; user: Person };
export type FileChange = { filename: string; status: string; additions: number; deletions: number; patch: string | null };
