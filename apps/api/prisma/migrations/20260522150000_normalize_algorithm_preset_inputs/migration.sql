-- AlterTable
ALTER TABLE "algorithm_presets" DROP COLUMN "inputs";

-- CreateTable
CREATE TABLE "algorithm_preset_inputs" (
    "id" TEXT NOT NULL,
    "algorithm_preset_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "position" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "algorithm_preset_inputs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "algorithm_preset_inputs_algorithm_preset_id_idx" ON "algorithm_preset_inputs"("algorithm_preset_id");

-- CreateIndex
CREATE UNIQUE INDEX "algorithm_preset_inputs_algorithm_preset_id_key_key" ON "algorithm_preset_inputs"("algorithm_preset_id", "key");

-- AddForeignKey
ALTER TABLE "algorithm_preset_inputs" ADD CONSTRAINT "algorithm_preset_inputs_algorithm_preset_id_fkey" FOREIGN KEY ("algorithm_preset_id") REFERENCES "algorithm_presets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
