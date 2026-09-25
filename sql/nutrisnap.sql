-- Additive migration; compatible with MySQL 5.7. No existing business tables changed.
CREATE TABLE IF NOT EXISTS nutrisnap_users (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  appid VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  openid VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  nickname VARCHAR(64) NOT NULL DEFAULT '',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_login_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_nutrisnap_identity (appid, openid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS nutrisnap_sessions (
  token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (token_hash),
  KEY idx_nutrisnap_session_expiry (expires_at),
  KEY idx_nutrisnap_session_user (user_id),
  CONSTRAINT fk_nutrisnap_session_user FOREIGN KEY (user_id) REFERENCES nutrisnap_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS nutrisnap_meals (
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  record_date DATE NOT NULL,
  meal VARCHAR(8) NOT NULL,
  record_time CHAR(5) NOT NULL,
  source VARCHAR(8) NOT NULL,
  items_json JSON NOT NULL,
  total_kcal INT UNSIGNED NOT NULL,
  revision INT UNSIGNED NOT NULL DEFAULT 1,
  deleted_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id, id),
  KEY idx_nutrisnap_meals_date (user_id, deleted_at, record_date),
  CONSTRAINT fk_nutrisnap_meal_user FOREIGN KEY (user_id) REFERENCES nutrisnap_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS nutrisnap_usage (
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  bucket VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  expires_at DATETIME NOT NULL,
  PRIMARY KEY (user_id, bucket),
  KEY idx_nutrisnap_usage_expiry (expires_at),
  CONSTRAINT fk_nutrisnap_usage_user FOREIGN KEY (user_id) REFERENCES nutrisnap_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
