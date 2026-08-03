import { useNavigate } from 'react-router-dom';
import { useSession } from '../session';

/**
 * Which household is on screen, a way to change it, and the way back out.
 *
 * A `<select>` rather than a menu: it is a one-of-n choice, and it gets the
 * platform's own picker on a phone for free.
 *
 * **It renders even with a single household**, which looks redundant and is
 * not. `/households` is not only a chooser — it is where another household is
 * created or joined — so collapsing this to plain text (as it first did) left
 * anyone with exactly one household, which is most people on their first day,
 * with no route to it at all. The chevron is the only affordance saying there
 * is anything beyond the household you are in.
 */
export default function HouseholdSwitcher() {
  const { household, households, switchHousehold } = useSession();
  const navigate = useNavigate();

  if (!household) return null;

  return (
    <select
      className="household-switcher"
      aria-label="Household"
      value={household.id}
      onChange={async (event) => {
        const id = event.target.value;
        if (id === MANAGE) {
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
      <option value={MANAGE}>
        {households.length > 1 ? 'All households…' : 'Households…'}
      </option>
    </select>
  );
}

/** Not a household id, and not a valid UUID, so it cannot collide with one. */
const MANAGE = '__manage__';
