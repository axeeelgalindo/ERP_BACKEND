const text = `Nombre ClienteBLUE INGENIERÍA SPAGiroRUTTeléfono+56 9 8229 4980
AtenciónDirecciónAv San Agustín La Paloma pc38
ComunaPuerto Montt
E-Mail
CÓDIGO
Administracion@blueinge.com
DESCRIPCIÓN
REPARACION DE OTRO TIPO DE MAQUINARIA Y EQUIPOS
CANT
PRECIO
DESCUENTOS
TOTAL
0016ES7511 1AL03-0AB0 SIMATIC S7-1500, CPU 1511-11,0$ 1.320.000,000,00$ 1.320.000,00
0016ES7954-8LF04-0AA0 SIMATIC S7, Tarjeta de memoria
para CPU S7-1x 001,0$ 372.000,000,00$ 372.000,00
0016ES7193 6PA00-0AA0 SIMATIC ET 200SP, spare part
Server module for ET 200SP6,0$ 84.000,000,00$ 504.000,00
0016ES7193 6BP00-0DA0 SIMATIC ET 200SP, BaseUnit
BU15 P16+A0+2D14,0$ 55.200,000,00$ 772.800,00
0016ES7505-0KA00-0AB0 SIMATIC S7-1500, fuente de
alimentación 24vac1,0$ 537.985,000,00$ 537.985,00
0016ES7155 6AA00-0BN0 SIMATIC ET 200SP, BUNDLE
PROFINET IM, IM155-6PN ST, HASTA 32 MÓDULOS6,0$ 432.000,000,00$ 2.592.000,00
0016ES7132-6BD01-0BA0 SIMATIC ET 200SP, módulo de
salidas digitales, DQ 8x 24V DC/0,5A estándar, sa..6,0$ 84.000,000,00$ 504.000,00
0016ES7134 6GB00-0BA1 SIMATIC ET 200SP, MÓDULO DE
ENTRADAS ANALÓGICAS, AI 2XI ESTÁNDAR DE 2/4
HILOS2,0$ 246.000,000,00$ 492.000,00
VALIDEZ DE LA OFERTA:
10 días
FORMA DE PAGO: TRANSFERENCIA
ENTREGA:
VENDEDOR:
NOTAS:
Diego Seguel
Neto$ 7.094.785,00
IVA$ 1.348.009,00
Total$ 8.442.794,00`;

function parseCleanNumber(val) {
  if (val === null || val === undefined) return null;
  if (typeof val === "number") return isNaN(val) ? null : val;
  const str = String(val).trim();
  if (!str) return null;
  let cleanStr = str.replace(/[\$\s€]/g, "");
  if (cleanStr.includes(".") && cleanStr.includes(",")) {
    if (cleanStr.lastIndexOf(",") > cleanStr.lastIndexOf(".")) {
      cleanStr = cleanStr.replace(/\./g, "").replace(",", ".");
    } else {
      cleanStr = cleanStr.replace(/,/g, "");
    }
  } else if (cleanStr.includes(".")) {
    const parts = cleanStr.split(".");
    if (parts.length > 2) {
      cleanStr = cleanStr.replace(/\./g, "");
    } else {
      if (parts[1].length === 3 && cleanStr.length >= 5) {
        cleanStr = cleanStr.replace(/\./g, "");
      }
    }
  } else if (cleanStr.includes(",")) {
    const parts = cleanStr.split(",");
    if (parts.length > 2) {
      cleanStr = cleanStr.replace(/,/g, "");
    } else {
      if (parts[1].length === 3 && cleanStr.length >= 5) {
        cleanStr = cleanStr.replace(/,/g, "");
      } else {
        cleanStr = cleanStr.replace(",", ".");
      }
    }
  }
  const num = Number(cleanStr);
  return isNaN(num) ? null : num;
}

function extractItemsFromText(text) {
  const lines = (text || "").split("\n");
  const items = [];
  const lineRegex = /^\s*(\d{1,3})\s+([\d,.]+)\s+(?:[a-zA-Z\.]+\s+)?\$?\s*([\d,.]+)\s+\$?\s*([\d,.]+)\s+([\d,.]+)/;
  
  console.log("=== Extracting lines ===");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(lineRegex);
    if (match) {
      console.log(`Match on line ${i}: ${line}`);
      // ...
    } else {
      console.log(`No match on line ${i}: ${line}`);
    }
  }
  return items;
}

extractItemsFromText(text);
