// ====== Shared API Client Interface ======
// Both mock and real API clients implement this shape.
// Using a broad interface with `any` parameters avoids contravariance
// issues while still enforcing structural compatibility at runtime
// and catching API method name mismatches at compile time.

import type { Result } from './types';
import type { ApiError } from './client';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface ApiClientShape {
  auth: {
    login(req: any): Promise<Result<any, ApiError>>;
    logout(): Promise<Result<any, ApiError>>;
    me(): Promise<Result<any, ApiError>>;
    updateProfile(patch: any): Promise<Result<any, ApiError>>;
  };
  sessions: {
    list(): Promise<Result<any, ApiError>>;
    create(req?: any): Promise<Result<any, ApiError>>;
    get(id: string): Promise<Result<any, ApiError>>;
    history(id: string, opts?: any): Promise<Result<any, ApiError>>;
    rename(id: string, title: string): Promise<Result<any, ApiError>>;
    delete(id: string): Promise<Result<any, ApiError>>;
    send(id: string, body: any): Promise<Result<any, ApiError>>;
    cancel(id: string): Promise<Result<any, ApiError>>;
  };
  tasks: {
    list(opts?: any): Promise<Result<any, ApiError>>;
    get(id: string): Promise<Result<any, ApiError>>;
    create(req: any): Promise<Result<any, ApiError>>;
    cancel(id: string): Promise<Result<any, ApiError>>;
    delete(id: string): Promise<Result<any, ApiError>>;
  };
  skills: {
    list(): Promise<Result<any, ApiError>>;
    install(id: string): Promise<Result<any, ApiError>>;
    uninstall(id: string): Promise<Result<any, ApiError>>;
    import(file: any): Promise<Result<any, ApiError>>;
    remove(id: string): Promise<Result<any, ApiError>>;
  };
  knowledge: {
    list(): Promise<Result<any, ApiError>>;
    search(query: string): Promise<Result<any, ApiError>>;
    get(id: string): Promise<Result<any, ApiError>>;
  };
  models: {
    list(): Promise<Result<any, ApiError>>;
    add(req: any): Promise<Result<any, ApiError>>;
    update(id: string, patch: any): Promise<Result<any, ApiError>>;
    remove(id: string): Promise<Result<any, ApiError>>;
    test(id: string): Promise<Result<any, ApiError>>;
    setDefault(id: string): Promise<Result<any, ApiError>>;
  };
  uploads: {
    file(file: any): Promise<Result<any, ApiError>>;
  };
  system: {
    status(): Promise<Result<any, ApiError>>;
    health(): Promise<Result<any, ApiError>>;
  };
}
