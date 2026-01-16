/*
  Warnings:

  - You are about to drop the column `cantidad` on the `Cotizacion` table. All the data in the column will be lost.
  - You are about to drop the column `descripcion` on the `Cotizacion` table. All the data in the column will be lost.
  - You are about to drop the `CotizacionItem` table. If the table is not empty, all the data it contains will be lost.
  - Made the column `cliente_id` on table `Cotizacion` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "Cotizacion" DROP CONSTRAINT "Cotizacion_cliente_id_fkey";

-- DropForeignKey
ALTER TABLE "Cotizacion" DROP CONSTRAINT "Cotizacion_proyecto_id_fkey";

-- DropForeignKey
ALTER TABLE "CotizacionItem" DROP CONSTRAINT "CotizacionItem_cotizacion_id_fkey";

-- DropForeignKey
ALTER TABLE "CotizacionItem" DROP CONSTRAINT "CotizacionItem_producto_id_fkey";

-- AlterTable
ALTER TABLE "Cotizacion" DROP COLUMN "cantidad",
DROP COLUMN "descripcion",
ADD COLUMN     "asunto" TEXT,
ALTER COLUMN "proyecto_id" DROP NOT NULL,
ALTER COLUMN "cliente_id" SET NOT NULL;

-- DropTable
DROP TABLE "CotizacionItem";

-- DropEnum
DROP TYPE "cotizacionItemTipo";

-- CreateTable
CREATE TABLE "CotizacionGlosa" (
    "id" TEXT NOT NULL,
    "cotizacion_id" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL,
    "monto" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "manual" BOOLEAN NOT NULL DEFAULT false,
    "orden" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CotizacionGlosa_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CotizacionGlosa_cotizacion_id_idx" ON "CotizacionGlosa"("cotizacion_id");

-- CreateIndex
CREATE INDEX "Cotizacion_cliente_id_idx" ON "Cotizacion"("cliente_id");

-- AddForeignKey
ALTER TABLE "Cotizacion" ADD CONSTRAINT "Cotizacion_proyecto_id_fkey" FOREIGN KEY ("proyecto_id") REFERENCES "Proyecto"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cotizacion" ADD CONSTRAINT "Cotizacion_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CotizacionGlosa" ADD CONSTRAINT "CotizacionGlosa_cotizacion_id_fkey" FOREIGN KEY ("cotizacion_id") REFERENCES "Cotizacion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
