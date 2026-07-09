import { getDatabase } from '@netlify/database';
import { pbkdf2Sync, randomBytes } from 'node:crypto';

const db=getDatabase();
const hashPassword=(p,s=randomBytes(16).toString('hex'))=>`${s}:${pbkdf2Sync(p,s,120000,32,'sha256').toString('hex')}`;
const owner=(process.env.OWNER_EMAIL||'admin@example.com').toLowerCase();
const password=process.env.SEED_ADMIN_PASSWORD||'ChangeMe123!';

const [admin]=await db.sql`INSERT INTO users(email,password_hash,role) VALUES(${owner},${hashPassword(password)},'admin') ON CONFLICT(email) DO UPDATE SET role='admin',updated_at=NOW() RETURNING id`;
const [sellerUser]=await db.sql`INSERT INTO users(email,password_hash,role) VALUES('seller@example.com',${hashPassword('Seller123!')},'seller') ON CONFLICT(email) DO UPDATE SET role='seller',updated_at=NOW() RETURNING id`;
const [seller]=await db.sql`INSERT INTO sellers(user_id,display_name,username,description) VALUES(${sellerUser.id},'Demo Seller','demo-seller','A trusted sample seller.') ON CONFLICT(username) DO UPDATE SET display_name=EXCLUDED.display_name RETURNING id`;
const [listing]=await db.sql`INSERT INTO listings(seller_id,title,slug,description,category,condition,price_cents,quantity,active,approved) VALUES(${seller.id},'Sample Marketplace Item','sample-marketplace-item','Replace this sample with a real seller listing.','Other','New',2500,5,TRUE,TRUE) ON CONFLICT(slug) DO UPDATE SET updated_at=NOW() RETURNING id`;
await db.sql`INSERT INTO listing_images(listing_id,url,sort_order) VALUES(${listing.id},'https://placehold.co/800x800?text=Sample+Item',0) ON CONFLICT DO NOTHING`;
await db.sql`INSERT INTO admin_settings(key,value) VALUES('platform_fee_percent',${process.env.PLATFORM_FEE_PERCENT||'15'}) ON CONFLICT(key) DO NOTHING`;
console.log('Seed complete. Admin:',owner,'Seller: seller@example.com');
