import { Link, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/pravidla")({
  component: RulesPage,
  head: () => ({
    meta: [
      { title: "Pravidla — Dilema" },
      { name: "description", content: "Úplná pravidla hry Dilema: příprava, průběh kol, vypořádání, poslední dva hráči a timeouty." },
    ],
  }),
});

function RulesPage() {
  return (
    <main className="min-h-screen px-6 py-12">
      <article className="mx-auto max-w-3xl">
        <Link to="/" className="mb-8 inline-flex text-sm font-semibold text-primary underline-offset-4 hover:underline">
          Zpět na hru
        </Link>

        <header className="mb-10">
          <h1 className="text-4xl font-black leading-tight text-foreground md:text-6xl">Pravidla hry Dilema</h1>
        </header>

        <div className="space-y-8 text-base leading-7 text-muted-foreground">
          <section>
            <h2 className="mb-3 text-2xl font-bold text-foreground">Příprava</h2>
            <ul className="list-disc space-y-2 pl-6">
              <li>Každý dostane 50 netů.</li>
              <li>Každý dostane balíček kartiček. Kartičky představují volbu 5, 10, 20, 30, 50, 100, 200, 500 netů, all-in nebo zloděje.</li>
            </ul>
          </section>

          <section>
            <h2 className="mb-3 text-2xl font-bold text-foreground">Průběh kola</h2>
            <p>Ve hře se opakují kola s těmito kroky:</p>
            <ol className="mt-3 list-decimal space-y-3 pl-6">
              <li>Všichni se rozhodnou, jestli přihodí a kolik, nebo jestli se rozhodnou krást. Položí odpovídající kartičku obrázkem dolů, aby ji ostatní neviděli.</li>
              <li>
                Pokud jsou všechny kartičky položené, je odhalení:
                <ul className="mt-2 list-disc space-y-2 pl-6">
                  <li>Pokud jsem přihazoval do banku, vezmu odpovídající počet žetonů a dám je před svou odhalenou kartičku.</li>
                  <li>Pokud jsem se rozhodl krást, jen otočím kartičku se zlodějem.</li>
                </ul>
              </li>
            </ol>
          </section>

          <section>
            <h2 className="mb-3 text-2xl font-bold text-foreground">Vypořádání</h2>
            <ul className="list-disc space-y-3 pl-6">
              <li>Pokud není nikdo zloděj, bankéř každému vysází k jeho žetonům ještě jednou tolik a hráč si je vezme.</li>
              <li>Pokud je právě jeden zloděj, bere si od každého jeho příhoz a s lupem definitivně opouští hru. Ostatní hráči, kteří mají nějaké žetony, pokračují dalším kolem od 1. kroku.</li>
              <li>Pokud jsou dva zloději, společně seberou příhozy, rozdělí si je napůl a ze hry odcházejí. Ostatní hráči, kteří mají nějaké žetony, pokračují dalším kolem od 1. kroku.</li>
              <li>Pokud jsou 3 a více zlodějů, bankéř sebere příhozy plus všechny žetony všech zlodějů a všechny žetony propadají do banku. Zloději ve hře končí. Ostatní hráči, kteří mají nějaké žetony, pokračují dalším kolem od 1. kroku.</li>
            </ul>
            <p className="mt-4">Kdo nemá na konci kola žetony, končí.</p>
          </section>

          <section>
            <h2 className="mb-3 text-2xl font-bold text-foreground">Poslední 2 hráči</h2>
            <p>Pokud zůstanou jen 2 hráči, už neopakují hrací kola popsaná výše, ale musí se naposled rozhodnout, jestli budou krást, nebo ne. Podle toho otočí kartičku zloděje nebo nějakou jinou, třeba all-in. Vypořádání posledního kola vypadá takto:</p>
            <ul className="mt-3 list-disc space-y-3 pl-6">
              <li>Pokud není žádný zloděj, každý hráč si odnáší tolik žetonů, kolik mají oba hráči dohromady.</li>
              <li>Pokud jsou oba zloději, každý si odnáší svůj aktuální počet žetonů.</li>
              <li>Pokud je jeden zloděj a druhý ne, zloděj okrádá čestného a odnáší si jeho i své žetony. Čestný odchází ze hry s prázdnou.</li>
            </ul>
          </section>

          <section>
            <h2 className="mb-3 text-2xl font-bold text-foreground">Zdržení</h2>
            <p>Pokud hráč ve stanoveném čase kolo neodehraje, automaticky se přihazuje minimální vklad. Jedná-li se o poslední kolo, hráč nekrade.</p>
          </section>

          <section>
            <h2 className="mb-3 text-2xl font-bold text-foreground">Zaokrouhlování</h2>
            <p>Pokud se ve hře dělí žetony, je to vždy na celá čísla se zbytkem. Případný zbytek propadá do banku.</p>
          </section>
        </div>
      </article>
    </main>
  );
}