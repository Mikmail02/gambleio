const eng = require('./engine.js'); 

console.log("Starter simulering av 1 000 000 spinn. Dette kan ta noen sekunder...");

// Kjører funksjonen OG lagrer resultatet den spytter ut
const resultat = eng.simulateRtp(1000000);

// Printer resultatet til terminalen slik at du kan se det
console.log("\n--- RESULTAT ---");
console.log(resultat);