import {Link,useSearchParams} from 'react-router-dom';
import {useAuth} from '../contexts/AuthContext';
import PageLayout from './PageLayout';

export default function ReviewAccessGate({children}) {
  const {user}=useAuth(),[params]=useSearchParams();
  if(params.get('review')==='true'&&user?.role!=='admin') return <PageLayout title="Administrator access required" eyebrow="Restricted access"
    intro="Only site administrators can view review queues or approve submissions.">
    <div className="empty-state" role="alert"><p>Your account does not have permission to review submissions.</p>
      <Link className="btn btn-primary" to="/my-events">Go to my dashboard</Link></div>
  </PageLayout>;
  return children;
}
