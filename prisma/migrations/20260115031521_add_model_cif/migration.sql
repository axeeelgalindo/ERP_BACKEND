/*
  Warnings:

  - You are about to drop the column `cif` on the `HHEmpleado` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "HHEmpleado" DROP COLUMN "cif",
ADD COLUMN     "cif_id" TEXT;

-- CreateTable
CREATE TABLE "CIF" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "anio" INTEGER,
    "mes" INTEGER,
    "valor" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "nota" TEXT,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CIF_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CIF_empresa_id_idx" ON "CIF"("empresa_id");

-- CreateIndex
CREATE INDEX "CIF_empresa_id_creado_en_idx" ON "CIF"("empresa_id", "creado_en");

-- CreateIndex
CREATE INDEX "CIF_empresa_id_anio_mes_idx" ON "CIF"("empresa_id", "anio", "mes");

-- AddForeignKey
ALTER TABLE "CIF" ADD CONSTRAINT "CIF_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HHEmpleado" ADD CONSTRAINT "HHEmpleado_cif_id_fkey" FOREIGN KEY ("cif_id") REFERENCES "CIF"("id") ON DELETE SET NULL ON UPDATE CASCADE;
