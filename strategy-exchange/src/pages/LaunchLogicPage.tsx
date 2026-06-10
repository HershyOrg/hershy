import { useEffect, useMemo, useState } from "react";
import { Button } from "../shared/components";
import {
  requestLaunchUserStrategyLogic,
  requestUserStrategyLogics,
} from "../features/strategy-exchange/api/strategyApi";
import type { StrategyLogicDraft, UserStrategyLogic } from "../features/strategy-exchange/types/strategyTypes";

const emptyDraft: StrategyLogicDraft = {
  name: "",
  description: "",
  strategyText: "",
  baseLogicId: "",
};

export function LaunchLogicPage({ onBack }: { onBack: () => void }) {
  const [userLogics, setUserLogics] = useState<UserStrategyLogic[]>([]);
  const [draft, setDraft] = useState<StrategyLogicDraft>(emptyDraft);
  const [selectedLogicId, setSelectedLogicId] = useState("");
  const [isLoadingLogics, setIsLoadingLogics] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    let active = true;

    const loadLogics = async () => {
      setIsLoadingLogics(true);
      setErrorMessage("");

      try {
        const response = await requestUserStrategyLogics();
        if (active) setUserLogics(response.logics);
      } catch {
        if (active) setErrorMessage("Saved logic could not be loaded.");
      } finally {
        if (active) setIsLoadingLogics(false);
      }
    };

    loadLogics();

    return () => {
      active = false;
    };
  }, []);

  const selectedLogic = useMemo(
    () => userLogics.find((logic) => logic.id === selectedLogicId) ?? null,
    [selectedLogicId, userLogics],
  );

  const canLaunch =
    draft.name.trim().length > 0 &&
    draft.description.trim().length > 0;

  const handleNewLogic = () => {
    setSelectedLogicId("");
    setDraft(emptyDraft);
    setErrorMessage("");
  };

  const handleSelectBaseLogic = (logicId: string) => {
    setSelectedLogicId(logicId);
    if (!logicId) {
      setDraft((currentDraft) => ({ ...currentDraft, baseLogicId: "" }));
      return;
    }

    const logic = userLogics.find((candidate) => candidate.id === logicId);
    if (!logic) return;
    setDraft({
      name: `${logic.name} Copy`,
      description: logic.description,
      strategyText: logic.strategyText,
      baseLogicId: logic.id,
    });
  };

  const handleLaunch = async () => {
    if (!canLaunch || isSaving) return;

    setIsSaving(true);
    setErrorMessage("");

    try {
      const response = await requestLaunchUserStrategyLogic(draft);
      const logic = response.logic;
      setUserLogics((currentLogics) => [logic, ...currentLogics.filter((item) => item.id !== logic.id)]);
      setSelectedLogicId(logic.id);
      setDraft({
        name: "",
        description: "",
        strategyText: "",
        baseLogicId: "",
      });
    } catch {
      setErrorMessage("Logic could not be launched.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <main className="launch-logic-layout">
      <div className="launch-logic-header">
        <Button variant="back" onClick={onBack}>
          Back
        </Button>
        <div>
          <span className="field-label">Strategy Builder</span>
          <h1>Launch Logic</h1>
        </div>
      </div>

      <section className="launch-logic-grid">
        <form
          className="launch-logic-form"
          onSubmit={(event) => {
            event.preventDefault();
            handleLaunch();
          }}
        >
          <div className="panel-heading">
            <span>New Logic</span>
            <strong>{selectedLogic ? `Based on ${selectedLogic.name}` : "Blank"}</strong>
          </div>

          <label>
            <span>Name</span>
            <input
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              placeholder="BTC Funding Logic"
            />
          </label>

          <label>
            <span>Description</span>
            <textarea
              value={draft.description}
              onChange={(event) => setDraft({ ...draft, description: event.target.value })}
              placeholder="What this logic does, where it runs, and when it should stop."
            />
          </label>

          {errorMessage ? <div className="form-error">{errorMessage}</div> : null}

          <Button variant="save" type="submit" disabled={!canLaunch || isSaving}>
            {isSaving ? "Launching..." : "Launch Logic"}
          </Button>
        </form>

        <aside className="launch-logic-side">
          <section className="launch-logic-panel">
            <div className="panel-heading">
              <span>My Logics</span>
              <strong>{userLogics.length}</strong>
            </div>
            <Button className="logic-new-button" onClick={handleNewLogic}>
              Create New Logic
            </Button>

            <label className="logic-select-field">
              <span>Start From Existing Logic</span>
              <select value={selectedLogicId} onChange={(event) => handleSelectBaseLogic(event.target.value)}>
                <option value="">Blank logic</option>
                {userLogics.map((logic) => (
                  <option key={logic.id} value={logic.id}>
                    {logic.name}
                  </option>
                ))}
              </select>
            </label>

            <div className="logic-list">
              {isLoadingLogics ? (
                <div className="logic-empty-state">Loading saved logics</div>
              ) : userLogics.length > 0 ? (
                userLogics.map((logic) => (
                  <button
                    type="button"
                    key={logic.id}
                    className={`logic-list-item${logic.id === selectedLogicId ? " active" : ""}`}
                    onClick={() => handleSelectBaseLogic(logic.id)}
                  >
                    <strong>{logic.name}</strong>
                    <span>{logic.description}</span>
                  </button>
                ))
              ) : (
                <div className="logic-empty-state">No saved logic yet</div>
              )}
            </div>
          </section>

        </aside>
      </section>
    </main>
  );
}
