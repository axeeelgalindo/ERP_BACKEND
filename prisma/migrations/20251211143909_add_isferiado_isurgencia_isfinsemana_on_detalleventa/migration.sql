-- AlterTable
ALTER TABLE "detalleVenta" ADD COLUMN     "isFeriado" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isFinSemana" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isUrgencia" BOOLEAN NOT NULL DEFAULT false;
