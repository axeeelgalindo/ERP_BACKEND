-- DropForeignKey
ALTER TABLE "detalleVenta" DROP CONSTRAINT "detalleVenta_compraId_fkey";

-- AddForeignKey
ALTER TABLE "detalleVenta" ADD CONSTRAINT "detalleVenta_compraId_fkey" FOREIGN KEY ("compraId") REFERENCES "CompraItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
