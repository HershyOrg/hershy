import { useMemo, useState, type FormEvent } from "react";
import type { UserAccountRow } from "../../demoDB";
import { requestUpdateUserProfile } from "../features/strategy-exchange/api/strategyApi";
import { creators } from "../features/strategy-exchange/store/strategyCatalog";
import { buildUserProfile } from "../features/strategy-exchange/store/userProfileStore";
import type { UserProfileDraft } from "../features/strategy-exchange/types/strategyTypes";
import { Button, UserAvatar } from "../shared/components";
import { formatAddress } from "../shared/utils/formatters";

export function EditMyPage({
  account,
  onBack,
  onSaved,
}: {
  account: UserAccountRow;
  onBack: () => void;
  onSaved: () => void;
}) {
  const creator = creators[account.creatorId];
  const profile = useMemo(() => buildUserProfile(creator, account), [account, creator]);
  const [name, setName] = useState(profile.name);
  const [handle, setHandle] = useState(profile.handle);
  const [bio, setBio] = useState(profile.bio);
  const [avatarUrl, setAvatarUrl] = useState(profile.avatarUrl);
  const [twitter, setTwitter] = useState(profile.twitter);
  const [github, setGithub] = useState(profile.github);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [profileEndpoint, setProfileEndpoint] = useState("");

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");

    const draft: UserProfileDraft = {
      name,
      handle: handle.startsWith("@") ? handle : `@${handle}`,
      bio,
      avatarUrl,
      twitter,
      github,
      exchanges: profile.exchanges,
      chains: profile.chains,
    };

    if (!draft.name.trim() || !draft.handle.trim() || !draft.bio.trim()) {
      setError("Name, handle, and bio are required.");
      return;
    }

    setIsSaving(true);
    try {
      const response = await requestUpdateUserProfile(account.eoaAddress, account.creatorId, draft);
      setProfileEndpoint(response.endpoint);
      onSaved();
    } catch {
      setError("Profile save failed.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <main className="profile-layout edit-profile-layout" data-profile-api-request={profileEndpoint}>
      <Button variant="back" onClick={onBack}>
        Back
      </Button>

      <section className="edit-profile-hero">
        <div>
          <span className="field-label">Edit My Page</span>
          <h1>Profile Settings</h1>
          <p>{formatAddress(account.eoaAddress)}</p>
        </div>
        <UserAvatar name={name || creator.name} src={avatarUrl} className="edit-profile-avatar" />
      </section>

      <form className="edit-profile-form" onSubmit={handleSubmit}>
        <section className="edit-profile-panel">
          <div className="panel-heading">
            <span>Identity</span>
            <strong>Public</strong>
          </div>
          <label>
            <span>Name</span>
            <input value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label>
            <span>Handle</span>
            <input value={handle} onChange={(event) => setHandle(event.target.value)} />
          </label>
          <label>
            <span>Bio</span>
            <textarea value={bio} onChange={(event) => setBio(event.target.value)} rows={5} />
          </label>
          <label>
            <span>Profile Image URL</span>
            <input value={avatarUrl} onChange={(event) => setAvatarUrl(event.target.value)} />
          </label>
        </section>

        <section className="edit-profile-panel">
          <div className="panel-heading">
            <span>Links</span>
            <strong>Optional</strong>
          </div>
          <label>
            <span>Twitter</span>
            <input value={twitter} onChange={(event) => setTwitter(event.target.value)} />
          </label>
          <label>
            <span>GitHub</span>
            <input value={github} onChange={(event) => setGithub(event.target.value)} />
          </label>
        </section>

        <div className="edit-profile-actions">
          {error ? <span>{error}</span> : <span />}
          <Button variant="save" type="submit" disabled={isSaving}>
            {isSaving ? "Saving" : "Save Profile"}
          </Button>
        </div>
      </form>
    </main>
  );
}
