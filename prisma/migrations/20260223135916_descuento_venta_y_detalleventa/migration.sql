-- AlterTable
ALTER TABLE "Venta" ADD COLUMN     "descuentoPct" DOUBLE PRECISION DEFAULT 0;

-- AlterTable
ALTER TABLE "detalleVenta" ADD COLUMN     "descuentoPct" DOUBLE PRECISION DEFAULT 0,
ADD COLUMN     "ventaTotalBruto" DOUBLE PRECISION;
