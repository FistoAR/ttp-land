-- ═══════════════════════════════════════════════════════════
--  TTP LAND — MySQL Database Schema
--  Run this file once to set up the database:
--    mysql -u root -p < schema.sql
-- ═══════════════════════════════════════════════════════════

-- CREATE DATABASE IF NOT EXISTS ttp_land CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
-- USE ttp_land;

-- ────────────────────────────────────────────────────────
--  USERS  (login accounts)
-- ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    username     VARCHAR(50)  NOT NULL UNIQUE,
    password     VARCHAR(255) NOT NULL,   -- bcrypt hash
    display_name VARCHAR(100) NOT NULL,
    role         ENUM('admin','staff') NOT NULL DEFAULT 'staff',
    created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Default admin user  (password: admin123)
-- Hash generated with bcrypt rounds=10
INSERT IGNORE INTO users (username, password, display_name, role)
VALUES (
    'admin',
    '$2a$10$rQv8P1sNrMiBQ2GdSmJjxODMVYqmzGFLjRFv3jO5GIbH3b4iBnFwu',
    'Admin',
    'admin'
);

-- ────────────────────────────────────────────────────────
--  MEDIATORS
-- ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mediators (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    name       VARCHAR(100) NOT NULL,
    phone      VARCHAR(15),
    location   VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_mediator_name (name)
);

-- Seed default mediators
INSERT IGNORE INTO mediators (name, phone, location) VALUES
    ('Anbu',      '9876543210', 'Chennai'),
    ('Babu',      '9876543211', 'Coimbatore'),
    ('Chandru',   '9876543212', 'Madurai'),
    ('Dinesh',    '9876543213', 'Salem'),
    ('Ezhil',     '9876543214', 'Trichy'),
    ('Ganesh',    '9876543215', 'Erode'),
    ('Ilayaraja', '9876543216', 'Tirunelveli');

-- ────────────────────────────────────────────────────────
--  PLOTS
-- ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS plots (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    plot_key     VARCHAR(50)  NOT NULL UNIQUE,   -- e.g. 'Plot1_1'  (SVG overlay ID)
    title        VARCHAR(100) NOT NULL,           -- e.g. 'Plot 1'
    plot_num     INT          NOT NULL,
    stamp_num    INT          NOT NULL,
    price        DECIMAL(12,2) DEFAULT 0,
    length_ft    DECIMAL(8,2)  DEFAULT 0,
    width_ft     DECIMAL(8,2)  DEFAULT 0,
    sqft         DECIMAL(10,2) DEFAULT 0,
    facing       VARCHAR(20),
    status       ENUM('available','booked','reserved','booked-registered') NOT NULL DEFAULT 'available',
    updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Seed plots  (matches the plotDB in script.js)
INSERT IGNORE INTO plots (plot_key, title, plot_num, stamp_num, price, length_ft, width_ft, sqft, facing, status) VALUES
    ('Plot1_1', 'Plot 1', 1, 1, 1500000, 30, 50, 1500, 'East',  'available'),
    ('Plot2_2', 'Plot 2', 2, 2, 1200000, 24, 50, 1200, 'North', 'available'),
    ('Plot3_3', 'Plot 3', 3, 3,  120000, 24, 50, 1200, 'North', 'available'),
    ('Plot4_4', 'Plot 4', 4, 4,  150000, 30, 50, 1500, 'East',  'available'),
    ('Plot5_5', 'Plot 5', 5, 5,  120000, 24, 50, 1200, 'North', 'available'),
    ('Plot6_6', 'Plot 6', 6, 6,  120000, 24, 50, 1200, 'North', 'available');

-- ────────────────────────────────────────────────────────
--  CUSTOMERS
-- ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS customers (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    plot_id         INT NOT NULL,
    customer_name   VARCHAR(150) NOT NULL,
    customer_phone  VARCHAR(15),
    mediator_name   VARCHAR(100),
    commission      DECIMAL(12,2) DEFAULT 0,
    booking_amount  DECIMAL(12,2) DEFAULT 0,
    closure_date    DATE,
    status          ENUM('booked','reserved','registered') NOT NULL DEFAULT 'booked',
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (plot_id) REFERENCES plots(id) ON DELETE CASCADE
);

-- ────────────────────────────────────────────────────────
--  INSTALLMENTS
-- ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS installments (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    customer_id  INT NOT NULL,
    amount       DECIMAL(12,2) NOT NULL DEFAULT 0,
    date_received DATE,
    follow_up_date DATE,
    created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
);
