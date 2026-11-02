import { FiArrowLeft, FiArrowRight, FiBookOpen, FiShield } from 'react-icons/fi'
import { Link } from 'react-router-dom'
import '../styles/legal.css'

const legalDocuments = {
  terms: {
    title: 'Terms of Service',
    intro: 'These terms explain the basic rules for using TeachOS. By creating an account or using the platform, you agree to follow them.',
    sections: [
      {
        title: 'Using TeachOS',
        paragraphs: [
          'TeachOS provides tools for educators to publish courses and batches, manage classroom activity, and maintain education-related records. Students can browse available offerings and manage their learning activity.',
          'Use the platform only for lawful educational and administrative purposes. You are responsible for making sure your use of TeachOS complies with applicable laws and any rules that apply to your school or organization.',
        ],
      },
      {
        title: 'Your account',
        paragraphs: [
          'Keep your sign-in details secure and provide accurate information for your account. You are responsible for activity carried out through your account. Tell the TeachOS administrator promptly if you believe someone has accessed it without permission.',
          'Choose the account role that describes how you use the platform. Access to features may depend on your role and may be changed to protect the platform or its users.',
        ],
      },
      {
        title: 'Courses and user content',
        paragraphs: [
          'You remain responsible for the material you submit, including course descriptions, teaching materials, assignments, messages, and classroom records. You must have the rights and permissions needed to share that material.',
          'You give TeachOS permission to host, display, and process your submitted material only as needed to operate and provide the platform. Do not upload content that is unlawful, infringes another person’s rights, or exposes private information without authorization.',
        ],
      },
      {
        title: 'Acceptable use',
        paragraphs: [
          'Do not misuse the service, attempt to access another person’s account or data, disrupt the platform, bypass access controls, or use TeachOS to distribute harmful or unlawful material. We may restrict access when reasonably needed to protect users, the service, or the law.',
        ],
      },
      {
        title: 'Payments and payouts',
        paragraphs: [
          'Payment and payout features in TeachOS are for record-keeping only. They do not transfer money, process card payments, or guarantee that a payment has been made. Arrange and verify any real-world payment separately with the relevant parties.',
        ],
      },
      {
        title: 'Availability and changes',
        paragraphs: [
          'We work to keep TeachOS useful and available, but features may change and interruptions can occur. We may update these terms as the service develops. The latest version will be posted on this page with its update date.',
        ],
      },
      {
        title: 'Questions',
        paragraphs: [
          'For questions about these terms or access to the service, contact the TeachOS administrator using the support channel provided to you.',
        ],
      },
    ],
  },
  privacy: {
    title: 'Privacy Policy',
    intro: 'This policy describes the information TeachOS handles to provide course, classroom, and account features, and the choices available to you.',
    sections: [
      {
        title: 'Information used by TeachOS',
        paragraphs: [
          'Depending on the features you use, TeachOS may handle account details such as your name, email address, role, and profile information; course and batch listings; and learning or classroom records such as enrollments, attendance, assignments, and payment or payout records.',
          'When you sign in, Firebase Authentication verifies your identity. TeachOS uses the resulting sign-in information to connect your account with platform features. Your password is managed by Firebase Authentication, not by TeachOS application records.',
        ],
      },
      {
        title: 'How information is used',
        paragraphs: [
          'Information is used to create and secure accounts, provide role-appropriate features, connect teachers with their listings and students with their own learning records, operate classroom tools, respond to support requests, and protect the service from misuse.',
          'Payment and payout details are recorded for reference in the platform. TeachOS does not move money or process payments through these records.',
        ],
      },
      {
        title: 'When information is shared',
        paragraphs: [
          'Information is available to the people and roles who need it for platform features—for example, teachers managing their own courses and classrooms, students viewing their own enrollments, and platform administrators operating and supporting TeachOS.',
          'TeachOS relies on service providers to run its infrastructure, including Firebase Authentication and the configured application hosting and database services. Information may also be disclosed when required by law or when necessary to protect users and the service.',
        ],
      },
      {
        title: 'Security and retention',
        paragraphs: [
          'TeachOS uses account-based access controls and takes reasonable steps to protect information. No online service can guarantee absolute security.',
          'Information is kept for as long as needed to provide the service, maintain relevant records, resolve issues, and meet applicable obligations. To ask about or request changes to your account information, contact the TeachOS administrator through the support channel provided to you.',
        ],
      },
      {
        title: 'Your choices and updates',
        paragraphs: [
          'Keep your account details accurate and avoid sharing sensitive information that is not needed for learning or teaching. You can sign out of TeachOS at any time; account or record removal requests can be directed to the TeachOS administrator.',
          'We may update this policy as the platform changes. The current version and its update date will be shown on this page.',
        ],
      },
      {
        title: 'Privacy questions',
        paragraphs: [
          'For questions or requests concerning your information, contact the TeachOS administrator using the support channel provided to you.',
        ],
      },
    ],
  },
}

export default function LegalPage({ document }) {
  const content = legalDocuments[document]
  const isTerms = document === 'terms'
  const otherPath = isTerms ? '/privacy-policy' : '/terms-of-service'
  const otherLabel = isTerms ? 'Privacy Policy' : 'Terms of Service'
  const Icon = isTerms ? FiBookOpen : FiShield

  return (
    <main className="legal-page">
      <div className="legal-shell">
        <header className="legal-header">
          <Link className="legal-brand" to="/" aria-label="TeachOS home">
            <span className="legal-brand-mark"><FiBookOpen /></span>
            <strong>TeachOS</strong>
          </Link>
          <Link className="legal-back" to="/register"><FiArrowLeft /> Back to sign up</Link>
        </header>

        <article className="legal-card">
          <div className="legal-heading">
            <span className="legal-icon"><Icon /></span>
            <p className="legal-eyebrow">TeachOS policies</p>
            <h1>{content.title}</h1>
            <p className="legal-updated">Last updated: October 29, 2026</p>
            <p className="legal-intro">{content.intro}</p>
          </div>

          <nav className="legal-document-nav" aria-label="Legal documents">
            <Link className={isTerms ? 'active' : ''} to="/terms-of-service">Terms of Service</Link>
            <Link className={!isTerms ? 'active' : ''} to="/privacy-policy">Privacy Policy</Link>
          </nav>

          <div className="legal-sections">
            {content.sections.map(({ title, paragraphs }, index) => (
              <section className="legal-section" key={title}>
                <span className="legal-section-number">{String(index + 1).padStart(2, '0')}</span>
                <div>
                  <h2>{title}</h2>
                  {paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
                </div>
              </section>
            ))}
          </div>

          <footer className="legal-footer">
            <Link to="/register"><FiArrowLeft /> Return to sign up</Link>
            <Link to={otherPath}>Read the {otherLabel.toLowerCase()} <FiArrowRight /></Link>
          </footer>
        </article>
        <p className="legal-copyright">&copy; {new Date().getFullYear()} TeachOS</p>
      </div>
    </main>
  )
}
