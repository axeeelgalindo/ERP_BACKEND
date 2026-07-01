import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const cots = await prisma.cotizacion.findMany({
    where: {
      parent_id: "cmr2gq2we00019y984gm0wodl"
    },
    include: {
      proyecto: true,
      cliente: true
    }
  });

  console.log(JSON.stringify(cots.map(c => ({
    id: c.id,
    numero: c.numero,
    es_suscripcion: c.es_suscripcion,
    asunto: c.asunto,
    estado: c.estado,
    fecha_inicio_plan: c.fecha_inicio_plan,
    fecha_fin_plan: c.fecha_fin_plan,
    creada_en: c.creada_en,
    fecha_documento: c.fecha_documento,
    proyecto_id: c.proyecto_id
  })), null, 2));
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
