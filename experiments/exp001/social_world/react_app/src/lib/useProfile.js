import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { useSession } from './useSession'

export function useProfile() {
  const session = useSession()
  const [profile, setProfile] = useState(undefined)

  useEffect(() => {
    if (!session) {
      setProfile(session === null ? null : undefined)
      return
    }
    supabase
      .from('profiles')
      .select('*')
      .eq('id', session.user.id)
      .maybeSingle()
      .then(({ data }) => setProfile(data))
  }, [session])

  return { session, profile }
}
