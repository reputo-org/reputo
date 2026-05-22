-- AlterTable
ALTER TABLE "snapshots" DROP COLUMN "outputs";

-- CreateTable
CREATE TABLE "snapshot_outputs" (
    "id" TEXT NOT NULL,
    "snapshot_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "snapshot_outputs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "snapshot_outputs_snapshot_id_idx" ON "snapshot_outputs"("snapshot_id");

-- CreateIndex
CREATE UNIQUE INDEX "snapshot_outputs_snapshot_id_key_key" ON "snapshot_outputs"("snapshot_id", "key");

-- AddForeignKey
ALTER TABLE "snapshot_outputs" ADD CONSTRAINT "snapshot_outputs_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
