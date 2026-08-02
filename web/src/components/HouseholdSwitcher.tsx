import { useNavigate } from 'react-router-dom';
import { useSession } from '../session';

/**
 * Which household is on screen, and a way to change it.
 *
 * A `<select>` rather than a menu: it is a one-of-n choice, it gets the
 * platform's own picker on a phone for free, and it collapses to the household
 * name when there is only one to choose from — which is most people, most of
 * the time. With a single household it renders as plain text, so nothing
 * suggests a choice that does not exist.
 */
export default function HouseholdSwitcher() {
  const { household, households, switchHousehold } = useSession();
  const navigate = useNavigate();

  if (!household) return null;

  if (households.length < 2) {
    return <span className="household-name">{household.name}</span>;
  }

  return (
    <select
      className="household-switcher"
      aria-label="Household"
      value={household.id}
      onChange={async (event) => {
        const id = event.target.value;
        if (id === '__manage__') {
          navigate('/households');
          return;
        }
        await switchHousehold(id);
        // Land on the dashboard: the page you were on may be about a row that
        // belongs to the household you just left.
        navigate('/', { replace: true });
      }}
    >
      {households.map((option) => (
        <option key={option.id} value={option.id}>
          {option.name}
        </option>
      ))}
      <option value="__manage__">Manage households…</option>
    </select>
  );
}
