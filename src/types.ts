export type UserRole = 'ADMIN' | 'TEACHER' | 'STUDENT';

export interface TokenPayload {
  id: number;
  email: string;
  username: string;
  role: UserRole;
}

export interface PaginatedQuery {
  search?: string;
  role?: UserRole;
  limit?: number;
  offset?: number;
}
