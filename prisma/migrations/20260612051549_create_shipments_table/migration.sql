-- Historical migration restored because it is already recorded as applied
-- in the production database. Do not rename or delete this directory.
CREATE TABLE IF NOT EXISTS "shipments" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Processing',
    "origin" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "weight" TEXT,
    "progress" INTEGER NOT NULL DEFAULT 15,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shipments_pkey" PRIMARY KEY ("id")
);
