/*
  Warnings:

  - You are about to drop the column `comentario_revision` on the `Rendicion` table. All the data in the column will be lost.
  - You are about to drop the column `creada_en` on the `Rendicion` table. All the data in the column will be lost.
  - You are about to drop the column `fecha_revision` on the `Rendicion` table. All the data in the column will be lost.
  - The `centro_costo` column on the `Rendicion` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - Added the required column `empresa_id` to the `Rendicion` table without a default value. This is not possible if the table is not empty.
  - Changed the type of `destino` on the `Rendicion` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- DropForeignKey
ALTER TABLE "Rendicion" DROP CONSTRAINT "Rendicion_empleado_id_fkey";

-- DropForeignKey
ALTER TABLE "Rendicion" DROP CONSTRAINT "Rendicion_proyecto_id_fkey";

-- DropIndex
DROP INDEX "Rendicion_destino_centro_costo_idx";

-- DropIndex
DROP INDEX "Rendicion_estado_idx";

-- DropIndex
DROP INDEX "Rendicion_proyecto_id_idx";

-- DropIndex
DROP INDEX "Rendicion_revisada_por_id_idx";

-- AlterTable
ALTER TABLE "Rendicion" DROP COLUMN "comentario_revision",
DROP COLUMN "creada_en",
DROP COLUMN "fecha_revision",
ADD COLUMN     "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "empresa_id" TEXT NOT NULL,
ADD COLUMN     "usuarioId" TEXT,
ALTER COLUMN "descripcion" DROP NOT NULL,
DROP COLUMN "centro_costo",
ADD COLUMN     "centro_costo" TEXT,
DROP COLUMN "destino",
ADD COLUMN     "destino" TEXT NOT NULL;

-- AddForeignKey
ALTER TABLE "Rendicion" ADD CONSTRAINT "Rendicion_proyecto_id_fkey" FOREIGN KEY ("proyecto_id") REFERENCES "Proyecto"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rendicion" ADD CONSTRAINT "Rendicion_empleado_id_fkey" FOREIGN KEY ("empleado_id") REFERENCES "Empleado"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rendicion" ADD CONSTRAINT "Rendicion_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
