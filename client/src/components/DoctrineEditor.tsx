import React, { useState, useCallback, useEffect } from "react";
import type { Doctrine } from "@doctrine/shared";

interface DoctrineEditorProps {
  doctrine: Doctrine;
  onDeploy: (doctrine: Doctrine) => Promise<void>;
}

export function DoctrineEditor({ doctrine, onDeploy }: DoctrineEditorProps) {
  const [text, setText] = useState(() => JSON.stringify(doctrine, null, 2));
  const [parseError, setParseError] = useState<string | null>(null);
  const [deploying, setDeploying] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Sync when doctrine changes externally (e.g. on init)
  useEffect(() => {
    if (!dirty) {
      setText(JSON.stringify(doctrine, null, 2));
    }
  }, [doctrine, dirty]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    setDirty(true);
    // Validate JSON live
    try {
      JSON.parse(e.target.value);
      setParseError(null);
    } catch (err: unknown) {
      setParseError(err instanceof Error ? err.message : "Invalid JSON");
    }
  }, []);

  const handleDeploy = useCallback(async () => {
    try {
      const parsed = JSON.parse(text) as Doctrine;

      // Basic validation
      if (!parsed.gatherer || !parsed.scout || !parsed.defender || !parsed.basePosition) {
        setParseError("Missing required fields: gatherer, scout, defender, basePosition");
        return;
      }

      setDeploying(true);
      await onDeploy(parsed);
      setDirty(false);
      setParseError(null);
    } catch (err: unknown) {
      setParseError(err instanceof Error ? err.message : "Deploy failed");
    } finally {
      setDeploying(false);
    }
  }, [text, onDeploy]);

  const handleReset = useCallback(() => {
    setText(JSON.stringify(doctrine, null, 2));
    setDirty(false);
    setParseError(null);
  }, [doctrine]);

  return (
    <div className="doctrine-editor">
      <div className="doctrine-editor-header">
        <h2>DOCTRINE</h2>
        <span className="doctrine-version">v{doctrine.version}</span>
        {dirty && <span className="doctrine-dirty">MODIFIED</span>}
      </div>
      <textarea
        className={`doctrine-textarea ${parseError ? "has-error" : ""}`}
        value={text}
        onChange={handleChange}
        spellCheck={false}
      />
      {parseError && <div className="doctrine-error">{parseError}</div>}
      <div className="doctrine-actions">
        <button
          className="btn btn-deploy"
          onClick={handleDeploy}
          disabled={!!parseError || deploying || !dirty}
        >
          {deploying ? "DEPLOYING..." : "DEPLOY"}
        </button>
        <button
          className="btn btn-secondary"
          onClick={handleReset}
          disabled={!dirty}
        >
          RESET
        </button>
      </div>
    </div>
  );
}
