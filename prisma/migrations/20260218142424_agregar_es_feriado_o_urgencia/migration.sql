-- AlterTable
ALTER TABLE "Venta" ADD COLUMN     "isFeriado" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isUrgencia" BOOLEAN NOT NULL DEFAULT false;
