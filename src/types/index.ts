export interface User {
  user_id: string;
  name: string;
  email: string;
  password?: string;
  profile_picture?: string;
  role: 'buyer' | 'seller' | 'admin';
  phone_number?: string;
  location?: string;
  kyc_status: 'pending' | 'verified' | 'rejected';
  trust_score: number;
  account_status: 'active' | 'suspended' | 'banned';
  last_active?: Date;
  created_at: Date;
  updated_at: Date;
}

export interface Location {
  location_id: string;
  state: string;
  city: string;
  area?: string;
  is_active: boolean;
  created_at: Date;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken?: string;
  user: Omit<User, 'password'>;
}

export interface RegisterRequest {
  name: string;
  email: string;
  password: string;
  role?: 'buyer' | 'seller';
  phone_number?: string;
  location?: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}