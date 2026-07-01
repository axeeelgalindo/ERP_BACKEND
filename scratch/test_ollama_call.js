import { analizarCotizacionConOllama } from "../src/modules/ia/ollama.service.js";

const quoteText = `Nos reservamos el derecho de cambiar los datos sin previo aviso. (100% volumétrico y 90% eficiencia mecánica).
La temperatura máxima del agua es de 35ºC.
● Regulador de presión neumático:
Regulador de presión controlado neumáticamente que permite trabajar desde 0 hasta la presión máxima del equipo.
Dispone de válvula limitadora y de ajuste fino.
● Dispositivo de seguridad:
Disco de ruptura certificado indicado para presión máxima del equipo +20%.
Cilindro en acero inoxidable; Sellado mediante empaques de alto rendimiento;
Pistones de metal duro macizo con sistema de auto centrado; Refrigeración por agua
● Kit de pistón
Bloque fabricado en acero inoxidable de alta resistencia; conjunto de válvula de acero al cromo-níquel
con montaje horizontal; Capacidad máxima de ajuste 2.800 bar (40.000 psi)
● Cabezal UAP
Caja de transmisi

BOMBA L-300/4 UAP
07/11/2025
00026978 / V0
DATOS DE LA COTIZACIÓN
Mr. Victor Morales
BLUE INGENIERIA
DATOS DEL CLIENTE
PROPUESTA COMERCIAL
COMET DO BRASIL INDUSTRIA E COMERCIO DE
EQUIPAMENTOS LTDA
CNPJ: 21.571.621/0001-03 IE: 353529602112

Código Acessórios Bomba Descrição Acessórios Bomba Quantidade Acessórios Bomba
8880.15038.1G MANG. 8/8H 15M M/M 9/16"UNF ESQ CRIS 3000BAR 7,00
8560.05012.16 MANG. 5/6H 5M M/M 3/8"UNF/3/8"UNF CRIS 2800BAR 4,00
1000.00163.1 PISTOLA DE HIDROJATEAMENTO PENTA BC 2800BAR 3,00
1000.00232.5 POWER BOX 2800BAR 3/8"BSP 3,00
1000.00242.0 DESTORCEDOR DE MANGUEIRA 5/6H - 3/4" UNF 3,00
3000.00210.0L LACO DE SEGURANCA 20,00
2320.00368.0 ANILHA 9/16" UNF LH INOX LM 14,00
2320.00314.0 PARAF. VAZADO M26X1,5 - 9/16" LM 14,00
3000.04342.0L MANG. AR 3/4" (15MT) 300PSI PR. 3/4" NPT M/M GIRAT 7,00
2320.00411.0 ANILHA 3/8"UNF LH LM 8,00
2320.00370.0 PARAF. VAZADO 3/4"UNF 3/8" LM 8,00
2380.02345.0 MANG. PU AZUL 6X4 10BAR 35,00
2380.02346.0 MANG. PU AZUL 8X5.5 10BAR 35,00
2320.00687.0 DISTR. Y 1X M26X1,5 HIP 2X M26X1.5HIP 3000BAR LM 2,00
192.000,00
USDTOTAL`;

console.log("Running actual analizarCotizacionConOllama...");
analizarCotizacionConOllama(quoteText)
  .then(res => {
    console.log("FINAL PARSED RESULT:", JSON.stringify(res, null, 2));
  })
  .catch(err => {
    console.error("FAILED! Error details:", err);
  });
