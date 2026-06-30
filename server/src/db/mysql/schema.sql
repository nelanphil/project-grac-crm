-- GRAC CRM MySQL Schema
-- Import this file via phpMyAdmin into the grac_crm database

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  role ENUM('super-admin', 'admin', 'owner', 'manager', 'tech', 'agent', 'customer') NOT NULL DEFAULT 'agent',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_users_email (email)
);

CREATE TABLE IF NOT EXISTS accounts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  type ENUM('business', 'individual', 'enterprise') NOT NULL DEFAULT 'business',
  owner_user_id INT NOT NULL,
  status ENUM('active', 'inactive', 'pending') NOT NULL DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_accounts_owner (owner_user_id)
);

CREATE TABLE IF NOT EXISTS permissions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  account_id INT NOT NULL,
  permission_level ENUM('read', 'write', 'admin') NOT NULL DEFAULT 'read',
  granted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
  UNIQUE KEY unique_user_account (user_id, account_id),
  INDEX idx_permissions_user (user_id),
  INDEX idx_permissions_account (account_id)
);

-- RBAC: maps roles to fine-grained permission strings
CREATE TABLE IF NOT EXISTS role_permissions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  role ENUM('super-admin', 'admin', 'owner', 'manager', 'tech', 'agent', 'customer') NOT NULL,
  permission VARCHAR(100) NOT NULL,
  UNIQUE KEY unique_role_permission (role, permission),
  INDEX idx_role_permissions_role (role)
);

-- Seed default permissions per role
-- admin: full access
INSERT IGNORE INTO role_permissions (role, permission) VALUES
  ('admin', 'leads:read'),
  ('admin', 'leads:write'),
  ('admin', 'leads:delete'),
  ('admin', 'accounts:read'),
  ('admin', 'accounts:write'),
  ('admin', 'accounts:delete'),
  ('admin', 'users:read'),
  ('admin', 'users:write'),
  ('admin', 'users:delete'),
  ('admin', 'permissions:manage'),
-- manager: leads + accounts (no user/permission management)
  ('manager', 'leads:read'),
  ('manager', 'leads:write'),
  ('manager', 'leads:delete'),
  ('manager', 'accounts:read'),
  ('manager', 'accounts:write'),
  ('manager', 'users:read'),
-- agent: read-only leads
  ('agent', 'leads:read'),
  ('agent', 'accounts:read');
