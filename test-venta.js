const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const p = await prisma.proyecto.findFirst({
        where: { nombre: { contains: 'SEST COT' } },
        include: {
            cotizaciones: {
                include: {
                    ventas: {
                        include: {
                            detalles: true
                        }
                    }
                }
            }
        }
    });
    console.log(JSON.stringify(p.cotizaciones[0].ventas[0], null, 2));
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
