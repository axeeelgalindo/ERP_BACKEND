/*
  Warnings:

  - You are about to drop the column `horasSemanales` on the `HHEmpleado` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "HHEmpleado" DROP COLUMN "horasSemanales",
ADD COLUMN     "horasMensuales" DOUBLE PRECISION;
