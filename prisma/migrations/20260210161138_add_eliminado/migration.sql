-- AlterTable
ALTER TABLE "Venta" ADD COLUMN     "eliminado" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "eliminado_en" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "detalleVenta" ADD COLUMN     "eliminado" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "eliminado_en" TIMESTAMP(3);
