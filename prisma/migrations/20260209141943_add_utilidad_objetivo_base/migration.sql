-- CreateEnum
CREATE TYPE "UtilidadBase" AS ENUM ('COSTO', 'VENTA');

-- AlterTable
ALTER TABLE "Venta" ADD COLUMN     "factorKAplicado" DOUBLE PRECISION,
ADD COLUMN     "utilidadObjetivoBase" "UtilidadBase" DEFAULT 'COSTO',
ADD COLUMN     "utilidadObjetivoPct" DOUBLE PRECISION;
