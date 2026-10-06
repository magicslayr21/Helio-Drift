import { useCallback, useState } from "react";
import GameShell from "./components/GameShell";
import DetailsPanel from "./components/DetailsPanel";

export default function App() {
  const [developer, setDeveloper] = useState(false);
  const [details, setDetails] = useState(false);
  const openDetails = useCallback(() => setDetails(true), []);
  const closeDetails = useCallback(() => setDetails(false), []);

  return (
    <div id="top" className="h-dvh w-full overflow-hidden bg-void">
      <GameShell
        onOpenDetails={openDetails}
        detailsOpen={details}
        onDeveloperChange={setDeveloper}
      />
      <DetailsPanel developer={developer} open={details} onClose={closeDetails} />
    </div>
  );
}
