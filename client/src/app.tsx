import AuthGate from '@/components/fayi/AuthGate';
import StudyApp from '@/components/fayi/StudyApp';

const RoutesComponent = () => {
  return <AuthGate><StudyApp /></AuthGate>;
};

export default RoutesComponent;
