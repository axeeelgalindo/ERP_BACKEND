-- CreateEnum
CREATE TYPE "CompraDestino" AS ENUM ('PROYECTO', 'ADMINISTRACION', 'TALLER');

-- CreateEnum
CREATE TYPE "CentroCosto" AS ENUM ('PMC', 'PUQ');

-- AlterTable
ALTER TABLE "Compra" ADD COLUMN     "centro_costo" "CentroCosto",
ADD COLUMN     "destino" "CompraDestino" NOT NULL DEFAULT 'PROYECTO',
ADD COLUMN     "rendicion_id" TEXT;

-- AlterTable
ALTER TABLE "Rendicion" ADD COLUMN     "centro_costo" "CentroCosto",
ADD COLUMN     "destino" "CompraDestino" NOT NULL DEFAULT 'PROYECTO',
ALTER COLUMN "proyecto_id" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "Compra_rendicion_id_idx" ON "Compra"("rendicion_id");

-- CreateIndex
CREATE INDEX "Compra_destino_centro_costo_idx" ON "Compra"("destino", "centro_costo");

-- CreateIndex
CREATE INDEX "Rendicion_destino_centro_costo_idx" ON "Rendicion"("destino", "centro_costo");

-- AddForeignKey
ALTER TABLE "Compra" ADD CONSTRAINT "Compra_rendicion_id_fkey" FOREIGN KEY ("rendicion_id") REFERENCES "Rendicion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
