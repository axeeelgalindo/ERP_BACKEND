-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EstadoCotizacion" ADD VALUE 'ACEPTADA';
ALTER TYPE "EstadoCotizacion" ADD VALUE 'RECHAZADA';

-- AlterTable
ALTER TABLE "Cotizacion" ADD COLUMN     "motivo_rechazo" TEXT;

-- AlterTable
ALTER TABLE "Proyecto" ADD COLUMN     "dias_plan" INTEGER,
ADD COLUMN     "dias_reales" INTEGER,
ADD COLUMN     "fecha_fin_plan" TIMESTAMP(3),
ADD COLUMN     "fecha_fin_real" TIMESTAMP(3),
ADD COLUMN     "fecha_inicio_plan" TIMESTAMP(3),
ADD COLUMN     "fecha_inicio_real" TIMESTAMP(3);
